import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

/**
 * In-memory imitation of the slice of the Keycloak 26 Admin REST API that
 * Central Admin uses. Paths, status codes and payload shapes follow Keycloak's
 * documented API. Test-only.
 */

interface Role {
  id: string;
  name: string;
  clientRole: true;
  containerId: string;
}
interface Client {
  id: string;
  clientId: string;
  roles: Role[];
}
interface User {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  createdTimestamp: number;
  requiredActions: string[];
  clientRoles: Map<string, Set<string>>; // client uuid -> role names
  groups: Set<string>; // group ids
  otp: boolean;
  sessions: number;
}
interface Group {
  id: string;
  name: string;
  path: string;
  clientRoles: Map<string, Set<string>>;
}

export interface FakeKeycloak {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  clients: Client[];
  users: User[];
  groups: Group[];
  emailsSent: { userId: string; actions: string[] }[];
  smtpWorks: boolean;
  addUser(input: { email: string; roles?: Record<string, string[]>; groups?: string[]; enabled?: boolean; otp?: boolean }): User;
  close(): Promise<void>;
}

export async function startFakeKeycloak(appRoles: Record<string, string[]>, groups: Record<string, Record<string, string[]>> = {}): Promise<FakeKeycloak> {
  const realm = 'slc';
  const clientId = 'central-admin-api';
  const clientSecret = 'svc-secret';
  const validTokens = new Set<string>();

  const clients: Client[] = Object.entries(appRoles).map(([cid, roles]) => {
    const id = randomUUID();
    return { id, clientId: cid, roles: roles.map((name) => ({ id: randomUUID(), name, clientRole: true, containerId: id })) };
  });
  const byClientId = (cid: string) => clients.find((c) => c.clientId === cid)!;
  const groupList: Group[] = Object.entries(groups).map(([name, roles]) => ({
    id: randomUUID(),
    name,
    path: `/${name}`,
    clientRoles: new Map(Object.entries(roles).map(([cid, names]) => [byClientId(cid).id, new Set(names)])),
  }));
  const users: User[] = [];

  const fake: FakeKeycloak = {
    baseUrl: '',
    realm,
    clientId,
    clientSecret,
    clients,
    users,
    groups: groupList,
    emailsSent: [],
    smtpWorks: true,
    addUser({ email, roles = {}, groups: gs = [], enabled = true, otp = true }) {
      const user: User = {
        id: randomUUID(),
        username: email,
        email,
        enabled,
        emailVerified: true,
        createdTimestamp: Date.now(),
        requiredActions: [],
        clientRoles: new Map(Object.entries(roles).map(([cid, names]) => [byClientId(cid).id, new Set(names)])),
        groups: new Set(gs.map((g) => groupList.find((x) => x.name === g)!.id)),
        otp,
        sessions: 1,
      };
      users.push(user);
      return user;
    },
    close: async () => undefined,
  };

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.post(`/realms/${realm}/protocol/openid-connect/token`, (req, res) => {
    if (req.body.grant_type !== 'client_credentials' || req.body.client_id !== clientId || req.body.client_secret !== clientSecret) {
      res.status(401).json({ error: 'unauthorized_client' });
      return;
    }
    const token = randomUUID();
    validTokens.add(token);
    res.json({ access_token: token, expires_in: 300, token_type: 'Bearer' });
  });

  const admin = express.Router();
  admin.use((req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    if (!token || !validTokens.has(token)) {
      res.status(401).json({ error: 'HTTP 401 Unauthorized' });
      return;
    }
    next();
  });

  const findUser = (id: string) => users.find((u) => u.id === id);
  const repr = (u: User) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    enabled: u.enabled,
    emailVerified: u.emailVerified,
    createdTimestamp: u.createdTimestamp,
    requiredActions: u.requiredActions,
  });
  const roleRepr = (client: Client, names: Iterable<string>) => client.roles.filter((r) => [...names].includes(r.name));

  admin.get('/clients', (req, res) => {
    res.json(clients.filter((c) => !req.query.clientId || c.clientId === req.query.clientId).map(({ id, clientId: cid }) => ({ id, clientId: cid })));
  });
  admin.get('/clients/:uuid/roles', (req, res) => {
    const client = clients.find((c) => c.id === req.params.uuid);
    if (!client) return void res.status(404).json({ error: 'Could not find client' });
    res.json(client.roles);
  });
  admin.get('/clients/:uuid/roles/:role/users', (req, res) => {
    res.json(users.filter((u) => u.clientRoles.get(req.params.uuid)?.has(req.params.role)).map(repr));
  });
  admin.get('/clients/:uuid/roles/:role/groups', (req, res) => {
    res.json(groupList.filter((g) => g.clientRoles.get(req.params.uuid)?.has(req.params.role)).map(({ id, name, path }) => ({ id, name, path })));
  });
  admin.get('/groups/:id/members', (req, res) => {
    res.json(users.filter((u) => u.groups.has(req.params.id)).map(repr));
  });

  admin.get('/users', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : '';
    const first = Number(req.query.first ?? 0);
    const max = Number(req.query.max ?? 100);
    res.json(users.filter((u) => !search || u.email?.includes(search)).slice(first, first + max).map(repr));
  });
  admin.post('/users', (req, res) => {
    if (users.some((u) => u.username === req.body.username)) {
      return void res.status(409).json({ errorMessage: 'User exists with same username' });
    }
    const user: User = {
      id: randomUUID(),
      username: req.body.username,
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      enabled: req.body.enabled ?? true,
      emailVerified: req.body.emailVerified ?? false,
      createdTimestamp: Date.now(),
      requiredActions: req.body.requiredActions ?? [],
      clientRoles: new Map(),
      groups: new Set(),
      otp: false,
      sessions: 0,
    };
    users.push(user);
    res.status(201).location(`${fake.baseUrl}/admin/realms/${realm}/users/${user.id}`).end();
  });
  admin.get('/users/:id', (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return void res.status(404).json({ error: 'User not found' });
    res.json(repr(user));
  });
  admin.put('/users/:id', (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return void res.status(404).json({ error: 'User not found' });
    if (typeof req.body.enabled === 'boolean') user.enabled = req.body.enabled;
    res.status(204).end();
  });
  admin.post('/users/:id/logout', (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return void res.status(404).json({ error: 'User not found' });
    user.sessions = 0;
    res.status(204).end();
  });
  admin.put('/users/:id/execute-actions-email', (req, res) => {
    if (!fake.smtpWorks) return void res.status(500).json({ errorMessage: 'Failed to send execute actions email' });
    fake.emailsSent.push({ userId: req.params.id, actions: req.body });
    res.status(204).end();
  });
  admin.get('/users/:id/groups', (req, res) => {
    const user = findUser(req.params.id)!;
    res.json(groupList.filter((g) => user.groups.has(g.id)).map(({ id, name, path }) => ({ id, name, path })));
  });
  admin.get('/users/:id/credentials', (req, res) => {
    const user = findUser(req.params.id)!;
    res.json([{ id: 'pw', type: 'password' }, ...(user.otp ? [{ id: 'otp', type: 'otp' }] : [])]);
  });
  admin.get('/users/:id/role-mappings', (req, res) => {
    const user = findUser(req.params.id)!;
    const clientMappings: Record<string, unknown> = {};
    for (const [uuid, names] of user.clientRoles) {
      const client = clients.find((c) => c.id === uuid)!;
      if (names.size > 0) clientMappings[client.clientId] = { id: uuid, client: client.clientId, mappings: roleRepr(client, names) };
    }
    res.json({ realmMappings: [], clientMappings });
  });
  admin.get('/users/:id/role-mappings/clients/:uuid', (req, res) => {
    const user = findUser(req.params.id)!;
    const client = clients.find((c) => c.id === req.params.uuid)!;
    res.json(roleRepr(client, user.clientRoles.get(client.id) ?? []));
  });
  admin.post('/users/:id/role-mappings/clients/:uuid', (req, res) => {
    const user = findUser(req.params.id)!;
    const set = user.clientRoles.get(req.params.uuid) ?? new Set<string>();
    for (const role of req.body as Role[]) set.add(role.name);
    user.clientRoles.set(req.params.uuid, set);
    res.status(204).end();
  });
  admin.delete('/users/:id/role-mappings/clients/:uuid', (req, res) => {
    const user = findUser(req.params.id)!;
    const set = user.clientRoles.get(req.params.uuid) ?? new Set<string>();
    for (const role of req.body as Role[]) set.delete(role.name);
    res.status(204).end();
  });

  app.use(`/admin/realms/${realm}`, admin);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}
