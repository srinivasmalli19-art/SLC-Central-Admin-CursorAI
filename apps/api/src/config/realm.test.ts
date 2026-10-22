import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { ROLE_KEYS } from '@slc/shared';

/**
 * Guards on the Keycloak realm export (infra/keycloak/realm-slc.json) for rules
 * that only show up against a real Keycloak.
 */
const realmPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../infra/keycloak/realm-slc.json');
const realm = JSON.parse(readFileSync(realmPath, 'utf8')) as {
  roles: { client: Record<string, { name: string }[]> };
  groups: { name: string; clientRoles?: Record<string, string[]> }[];
  clients: { clientId: string; publicClient?: boolean; standardFlowEnabled?: boolean; attributes?: Record<string, string> }[];
};

describe('Keycloak realm export', () => {
  it('has no client role named "admin" (Keycloak refuses to let Central Admin grant it)', () => {
    for (const [clientId, roles] of Object.entries(realm.roles.client)) {
      expect(roles.map((r) => r.name), clientId).not.toContain('admin');
    }
  });

  it('only references roles that exist', () => {
    for (const group of realm.groups) {
      for (const [clientId, roles] of Object.entries(group.clientRoles ?? {})) {
        const defined = (realm.roles.client[clientId] ?? []).map((r) => r.name);
        for (const role of roles) {
          expect(defined, `${group.name} → ${clientId}:${role}`).toContain(role);
        }
      }
    }
  });

  it('defines every Central Admin role key', () => {
    const defined = realm.roles.client['central-admin']!.map((r) => r.name).sort();
    expect(defined).toEqual([...ROLE_KEYS].sort());
  });

  it('requires PKCE (S256) on every browser client that can sign in', () => {
    for (const client of realm.clients.filter((c) => c.publicClient && c.standardFlowEnabled)) {
      expect(client.attributes?.['pkce.code.challenge.method'], client.clientId).toBe('S256');
    }
  });
});

describe('production realm export (infra/keycloak/production)', () => {
  const prodDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../infra/keycloak/production');

  it('is regenerated from the dev realm (run make-prod-realm.mjs after editing realm-slc.json)', async () => {
    const { makeProdRealm } = (await import(path.join(prodDir, 'make-prod-realm.mjs'))) as {
      makeProdRealm: (dev: unknown) => unknown;
    };
    const expected = `${JSON.stringify(makeProdRealm(realm), null, 2)}\n`;
    expect(readFileSync(path.join(prodDir, 'realm-slc.prod.json'), 'utf8')).toBe(expected);
  });

  it('carries no test accounts, dev secrets or localhost addresses', () => {
    const text = readFileSync(path.join(prodDir, 'realm-slc.prod.json'), 'utf8');
    const prod = JSON.parse(text) as { users: { username: string; serviceAccountClientId?: string }[] };
    // Service accounts, plus exactly one first Super Admin taken from the
    // environment (no committed email or password).
    const people = prod.users.filter((u) => !u.serviceAccountClientId) as {
      username: string;
      credentials?: { value: string; temporary: boolean }[];
      requiredActions?: string[];
      groups?: string[];
    }[];
    expect(people).toHaveLength(1);
    expect(people[0]!.username).toBe('${FIRST_SUPER_ADMIN_EMAIL}');
    expect(people[0]!.credentials).toEqual([
      { type: 'password', value: '${FIRST_SUPER_ADMIN_TEMP_PASSWORD}', temporary: true },
    ]);
    expect(people[0]!.requiredActions).toEqual(['UPDATE_PASSWORD', 'CONFIGURE_TOTP']);
    expect(people[0]!.groups).toEqual(['/slc-super-admins']);
    expect(text).not.toMatch(/dev-only|localhost|127\.0\.0\.1|host\.docker\.internal/);
  });
});
