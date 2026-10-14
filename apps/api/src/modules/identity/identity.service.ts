import type {
  AppRoleMap,
  IdentityUser,
  InviteIdentityUserInput,
  InviteIdentityUserResult,
  ManagedApp,
} from '@slc/shared';

import { getPrisma } from '../../db/prisma.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../lib/logger.js';
import { writeAuditLog } from '../audit/auditLog.service.js';
import { hasPermission, type ResolvedAdmin } from '../auth/permissions.js';
import { revokeAllSessions } from '../auth/session.service.js';
import { revokeFirebaseSessions } from '../bridge/firebaseBridge.service.js';
import {
  getClientUuid,
  kcRequest,
  KeycloakAdminError,
  requireKeycloakAdminConfig,
  type KcCredential,
  type KcGroup,
  type KcRole,
  type KcUser,
} from './keycloakAdmin.client.js';

/**
 * Central management of SLC admin identities held in Keycloak: who may sign in,
 * and which role they hold in each SLC application.
 *
 * Safeguards (enforced here, server-side):
 * - Only admins with `system.manage` may grant or remove Central Admin's
 *   SUPER_ADMIN role, or change anything about an existing Super Admin.
 * - The last enabled Central Admin Super Admin cannot be disabled or demoted.
 * - Admins cannot disable themselves.
 * Every change is written to the audit log.
 */

const CENTRAL_ADMIN_CLIENT = 'central-admin';
const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';
const INVITE_ACTIONS = ['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'VERIFY_EMAIL'];
const INVITE_LINK_LIFESPAN_SECONDS = 72 * 60 * 60;

export interface ActorContext {
  admin: ResolvedAdmin;
  ipAddress?: string;
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Apps and roles
// ---------------------------------------------------------------------------

export async function listManagedApps(): Promise<ManagedApp[]> {
  const cfg = requireKeycloakAdminConfig();
  const apps = await Promise.all(
    cfg.managedApps.map(async (app): Promise<ManagedApp | null> => {
      try {
        const uuid = await getClientUuid(app.clientId);
        const { data } = await kcRequest<KcRole[]>('GET', `/clients/${uuid}/roles`);
        return { clientId: app.clientId, name: app.name, roles: data.map((role) => role.name).sort() };
      } catch (error) {
        if (error instanceof AppError && error.code === 'APP_NOT_FOUND') {
          logger.warn({ clientId: app.clientId }, 'managed_app_missing_in_keycloak');
          return null;
        }
        throw error;
      }
    }),
  );
  return apps.filter((app): app is ManagedApp => app !== null);
}

async function clientRoles(clientId: string): Promise<KcRole[]> {
  const uuid = await getClientUuid(clientId);
  const { data } = await kcRequest<KcRole[]>('GET', `/clients/${uuid}/roles`);
  return data;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function toIdentityUser(user: KcUser): Promise<IdentityUser> {
  const cfg = requireKeycloakAdminConfig();
  const managed = new Set(cfg.managedApps.map((app) => app.clientId));
  const [mappings, groups, credentials] = await Promise.all([
    kcRequest<{ clientMappings?: Record<string, { client: string; mappings: KcRole[] }> }>(
      'GET',
      `/users/${user.id}/role-mappings`,
    ),
    kcRequest<KcGroup[]>('GET', `/users/${user.id}/groups`),
    kcRequest<KcCredential[]>('GET', `/users/${user.id}/credentials`),
  ]);

  const appRoles: AppRoleMap = {};
  for (const [clientId, entry] of Object.entries(mappings.data.clientMappings ?? {})) {
    if (managed.has(clientId)) {
      appRoles[clientId] = entry.mappings.map((role) => role.name).sort();
    }
  }

  return {
    id: user.id,
    email: user.email ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    enabled: user.enabled,
    emailVerified: user.emailVerified ?? false,
    mfaEnrolled: credentials.data.some((credential) => credential.type === 'otp'),
    pendingActions: user.requiredActions ?? [],
    createdAt: user.createdTimestamp ? new Date(user.createdTimestamp).toISOString() : null,
    appRoles,
    groups: groups.data.map((group) => group.path).sort(),
  };
}

/**
 * Keycloak's `search` matches only the START of username, email, first or last
 * name unless the term contains `*`. Admins expect "kumar" or "slc.local" to
 * match anywhere, so wrap the (cleaned) term in wildcards.
 */
export function keycloakSearchTerm(raw: string | undefined): string | null {
  const term = (raw ?? '').replace(/[*"]/g, '').trim().slice(0, 100);
  return term ? `*${term}*` : null;
}

export async function listUsers(params: { search?: string; first?: number; max?: number }): Promise<IdentityUser[]> {
  const query = new URLSearchParams({
    briefRepresentation: 'false',
    first: String(params.first ?? 0),
    max: String(Math.min(params.max ?? 50, 100)),
  });
  const search = keycloakSearchTerm(params.search);
  if (search) {
    query.set('search', search);
  }
  const { data } = await kcRequest<KcUser[]>('GET', `/users?${query.toString()}`);
  return Promise.all(data.map(toIdentityUser));
}

export async function getUser(id: string): Promise<IdentityUser> {
  const { data } = await kcRequest<KcUser>('GET', `/users/${encodeURIComponent(id)}`);
  return toIdentityUser(data);
}

/** Enabled users holding Central Admin SUPER_ADMIN, directly or through a group. */
async function superAdminIds(): Promise<Set<string>> {
  const uuid = await getClientUuid(CENTRAL_ADMIN_CLIENT);
  const rolePath = `/clients/${uuid}/roles/${SUPER_ADMIN_ROLE}`;
  const [direct, groups] = await Promise.all([
    kcRequest<KcUser[]>('GET', `${rolePath}/users?max=1000`),
    kcRequest<KcGroup[]>('GET', `${rolePath}/groups?max=1000`),
  ]);
  const members = await Promise.all(
    groups.data.map((group) => kcRequest<KcUser[]>('GET', `/groups/${group.id}/members?max=1000`)),
  );
  const ids = new Set<string>();
  for (const user of [...direct.data, ...members.flatMap((m) => m.data)]) {
    if (user.enabled) {
      ids.add(user.id);
    }
  }
  return ids;
}

async function actorSubject(actor: ActorContext): Promise<string | null> {
  const prisma = getPrisma();
  if (!prisma) {
    return null;
  }
  const row = await prisma.adminUser.findUnique({ where: { id: actor.admin.id }, select: { oidcSubject: true } });
  return row?.oidcSubject ?? null;
}

function requireSystemManage(actor: ActorContext, why: string): void {
  if (!hasPermission(actor.admin, 'system.manage')) {
    throw new AppError(403, 'FORBIDDEN', why);
  }
}

/** Reject unknown apps and roles before touching Keycloak. */
async function validateAppRoles(appRoles: AppRoleMap): Promise<Map<string, KcRole[]>> {
  const cfg = requireKeycloakAdminConfig();
  const managed = new Set(cfg.managedApps.map((app) => app.clientId));
  const resolved = new Map<string, KcRole[]>();
  for (const [clientId, roles] of Object.entries(appRoles)) {
    if (!managed.has(clientId)) {
      throw new AppError(422, 'VALIDATION_ERROR', `"${clientId}" is not a managed SLC app.`);
    }
    const available = await clientRoles(clientId);
    const picked: KcRole[] = [];
    for (const name of new Set(roles)) {
      const role = available.find((r) => r.name === name);
      if (!role) {
        throw new AppError(422, 'VALIDATION_ERROR', `"${name}" is not a role of ${clientId}.`);
      }
      picked.push(role);
    }
    resolved.set(clientId, picked);
  }
  return resolved;
}

/** Apply exactly the given roles for each listed app (apps not listed are untouched). */
async function applyAppRoles(userId: string, resolved: Map<string, KcRole[]>): Promise<{ added: string[]; removed: string[] }> {
  const added: string[] = [];
  const removed: string[] = [];
  for (const [clientId, desired] of resolved) {
    const uuid = await getClientUuid(clientId);
    const path = `/users/${userId}/role-mappings/clients/${uuid}`;
    const { data: current } = await kcRequest<KcRole[]>('GET', path);
    const toAdd = desired.filter((role) => !current.some((c) => c.name === role.name));
    const toRemove = current.filter((role) => !desired.some((d) => d.name === role.name));
    if (toAdd.length > 0) {
      await kcRequest('POST', path, toAdd);
      added.push(...toAdd.map((role) => `${clientId}:${role.name}`));
    }
    if (toRemove.length > 0) {
      await kcRequest('DELETE', path, toRemove);
      removed.push(...toRemove.map((role) => `${clientId}:${role.name}`));
    }
  }
  return { added, removed };
}

export async function inviteUser(
  input: InviteIdentityUserInput,
  actor: ActorContext,
): Promise<InviteIdentityUserResult> {
  const cfg = requireKeycloakAdminConfig();
  const email = input.email.trim().toLowerCase();

  if ((input.appRoles[CENTRAL_ADMIN_CLIENT] ?? []).includes(SUPER_ADMIN_ROLE)) {
    requireSystemManage(actor, 'Only a Super Admin can create another Super Admin.');
  }
  const resolved = await validateAppRoles(input.appRoles);

  const { location } = await kcRequest('POST', '/users', {
    username: email,
    email,
    firstName: input.firstName?.trim() || undefined,
    lastName: input.lastName?.trim() || undefined,
    enabled: true,
    emailVerified: false,
    requiredActions: INVITE_ACTIONS,
  });
  const userId = location?.split('/').pop();
  if (!userId) {
    throw new AppError(502, 'IDENTITY_PROVIDER_ERROR', 'The identity provider did not return the new user id.');
  }

  const { added } = await applyAppRoles(userId, resolved);

  let invitationEmailSent = false;
  if (cfg.sendInviteEmail) {
    try {
      await kcRequest(
        'PUT',
        `/users/${userId}/execute-actions-email?lifespan=${INVITE_LINK_LIFESPAN_SECONDS}`,
        INVITE_ACTIONS,
      );
      invitationEmailSent = true;
    } catch (error) {
      // Usually: SMTP not configured in the realm. The account still exists.
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'identity_invite_email_failed');
    }
  }

  await writeAuditLog({
    action: 'IDENTITY_USER_INVITED',
    actorId: actor.admin.id,
    actorEmail: actor.admin.email,
    targetType: 'IdentityUser',
    targetId: userId,
    metadata: { email, roles: added, invitationEmailSent },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { user: await getUser(userId), invitationEmailSent, invitationEmailEnabled: cfg.sendInviteEmail };
}

export async function setUserAppRoles(userId: string, appRoles: AppRoleMap, actor: ActorContext): Promise<IdentityUser> {
  const before = await getUser(userId);
  const supersBefore = await superAdminIds();
  // Super Admin directly or through a group (e.g. /slc-super-admins).
  const hadSuper = (before.appRoles[CENTRAL_ADMIN_CLIENT] ?? []).includes(SUPER_ADMIN_ROLE) || supersBefore.has(userId);
  const touchesCentral = CENTRAL_ADMIN_CLIENT in appRoles;
  const wantsSuper = (appRoles[CENTRAL_ADMIN_CLIENT] ?? []).includes(SUPER_ADMIN_ROLE);

  if (hadSuper || (touchesCentral && wantsSuper)) {
    requireSystemManage(actor, 'Only a Super Admin can change a Super Admin or grant that role.');
  }
  if ((await actorSubject(actor)) === userId) {
    requireSystemManage(actor, 'You cannot change your own access. Ask a Super Admin.');
  }
  const directSuper = (before.appRoles[CENTRAL_ADMIN_CLIENT] ?? []).includes(SUPER_ADMIN_ROLE);
  if (directSuper && touchesCentral && !wantsSuper) {
    const supers = new Set(supersBefore);
    supers.delete(userId);
    if (supers.size === 0) {
      throw new AppError(409, 'LAST_SUPER_ADMIN', 'This is the last Super Admin; grant the role to someone else first.');
    }
  }

  const resolved = await validateAppRoles(appRoles);
  const { added, removed } = await applyAppRoles(userId, resolved);

  // Roles are read at sign-in. When access is removed, end the person's
  // Central Admin sessions so the removal applies now, not at next sign-in.
  let localSessionsRevoked = 0;
  if (removed.length > 0) {
    const prisma = getPrisma();
    const local = prisma ? await prisma.adminUser.findUnique({ where: { oidcSubject: userId }, select: { id: true } }) : null;
    if (local) localSessionsRevoked = await revokeAllSessions(local.id);
  }

  if (added.length > 0 || removed.length > 0) {
    await writeAuditLog({
      action: 'IDENTITY_ROLES_CHANGED',
      actorId: actor.admin.id,
      actorEmail: actor.admin.email,
      targetType: 'IdentityUser',
      targetId: userId,
      metadata: { email: before.email, added, removed, localSessionsRevoked },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
  return getUser(userId);
}

/** End every session of this person: in Keycloak (all apps) and in Central Admin. */
async function endAllSessions(userId: string): Promise<number> {
  await kcRequest('POST', `/users/${encodeURIComponent(userId)}/logout`);
  // Firebase-backed apps (Pasumithra, JeevaMitra) keep their own refresh tokens.
  await revokeFirebaseSessions(userId);
  const prisma = getPrisma();
  if (!prisma) {
    return 0;
  }
  const local = await prisma.adminUser.findUnique({ where: { oidcSubject: userId }, select: { id: true } });
  return local ? revokeAllSessions(local.id) : 0;
}

export async function setUserEnabled(userId: string, enabled: boolean, actor: ActorContext): Promise<IdentityUser> {
  const before = await getUser(userId);

  if (!enabled) {
    if ((await actorSubject(actor)) === userId) {
      throw new AppError(409, 'SELF_DISABLE', 'You cannot disable your own account.');
    }
    const supers = await superAdminIds();
    if (supers.has(userId)) {
      requireSystemManage(actor, 'Only a Super Admin can disable a Super Admin.');
      supers.delete(userId);
      if (supers.size === 0) {
        throw new AppError(409, 'LAST_SUPER_ADMIN', 'This is the last Super Admin and cannot be disabled.');
      }
    }
  }

  await kcRequest('PUT', `/users/${encodeURIComponent(userId)}`, { enabled });
  const revoked = enabled ? 0 : await endAllSessions(userId);

  await writeAuditLog({
    action: enabled ? 'IDENTITY_USER_ENABLED' : 'IDENTITY_USER_DISABLED',
    actorId: actor.admin.id,
    actorEmail: actor.admin.email,
    targetType: 'IdentityUser',
    targetId: userId,
    metadata: { email: before.email, ...(enabled ? {} : { localSessionsRevoked: revoked }) },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return getUser(userId);
}

export async function signOutUserEverywhere(userId: string, actor: ActorContext): Promise<void> {
  const user = await getUser(userId);
  const revoked = await endAllSessions(userId);
  await writeAuditLog({
    action: 'IDENTITY_USER_SIGNED_OUT',
    actorId: actor.admin.id,
    actorEmail: actor.admin.email,
    targetType: 'IdentityUser',
    targetId: userId,
    metadata: { email: user.email, localSessionsRevoked: revoked },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

/** Re-send the set-password + MFA email. */
export async function resendInvite(userId: string, actor: ActorContext): Promise<void> {
  const user = await getUser(userId);
  const actions = user.pendingActions.length > 0 ? user.pendingActions : ['UPDATE_PASSWORD'];
  try {
    await kcRequest(
      'PUT',
      `/users/${encodeURIComponent(userId)}/execute-actions-email?lifespan=${INVITE_LINK_LIFESPAN_SECONDS}`,
      actions,
    );
  } catch (error) {
    if (error instanceof KeycloakAdminError) {
      throw new AppError(502, 'INVITE_EMAIL_FAILED', 'The identity provider could not send the email. Check its SMTP settings.');
    }
    throw error;
  }
  await writeAuditLog({
    action: 'IDENTITY_INVITE_RESENT',
    actorId: actor.admin.id,
    actorEmail: actor.admin.email,
    targetType: 'IdentityUser',
    targetId: userId,
    metadata: { email: user.email, actions },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}
