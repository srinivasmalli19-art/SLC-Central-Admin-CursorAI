#!/usr/bin/env node
/**
 * Builds the PRODUCTION realm import (realm-slc.prod.json) from the dev realm
 * (../realm-slc.json), so both stay in step:
 *
 *  - drops the dev test accounts (superadmin@slc.local, support@slc.local);
 *  - replaces every client secret with an environment placeholder;
 *  - replaces localhost URLs with each app's real address from the environment;
 *  - keeps roles, groups, scopes, MFA, password and brute-force policy as is.
 *
 * Keycloak fills `${VAR}` placeholders from its environment when it imports
 * the file, so no secret or URL is ever committed.
 *
 *   node infra/keycloak/production/make-prod-realm.mjs          # write the file
 *   node infra/keycloak/production/make-prod-realm.mjs --check  # fail if out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const devPath = path.join(here, '..', 'realm-slc.json');
const outPath = path.join(here, 'realm-slc.prod.json');

/**
 * Per client: env var holding its secret (confidential clients), its app URL,
 * and (when different) the base URL its back-channel logout notice goes to.
 */
const CLIENTS = {
  'central-admin': { secretEnv: 'KC_SECRET_CENTRAL_ADMIN', urlEnv: 'CENTRAL_ADMIN_URL' },
  'central-admin-api': { secretEnv: 'KC_SECRET_CENTRAL_ADMIN_API' },
  'pasumithra-admin': { urlEnv: 'PASUMITHRA_ADMIN_URL' },
  'slcvet-admin': { urlEnv: 'SLCVET_URL' },
  'stock-admin': { urlEnv: 'STOCK_URL', backchannelEnv: 'STOCK_API_URL' },
  'pasunestam-admin': { urlEnv: 'PASUNESTAM_URL' },
  'jeevamitra-admin': {},
  'nearsip-admin': { secretEnv: 'KC_SECRET_NEARSIP' },
};

const isLocal = (value) => /localhost|127\.0\.0\.1|host\.docker\.internal/.test(value);

/** http://localhost:5173/api/v1/... -> ${CENTRAL_ADMIN_URL}/api/v1/... */
function toProdUrl(value, urlEnv) {
  if (!isLocal(value)) return value;
  if (!urlEnv) return null;
  const pathPart = value.replace(/^https?:\/\/[^/]+/, '');
  return `\${${urlEnv}}${pathPart}`;
}

export function makeProdRealm(dev) {
  const realm = structuredClone(dev);

  // Only service-account users survive; people are invited through Central Admin.
  realm.users = (realm.users ?? []).filter((u) => u.serviceAccountClientId);

  for (const client of realm.clients) {
    const spec = CLIENTS[client.clientId];
    if (!spec) throw new Error(`No production settings for client ${client.clientId}; add it to CLIENTS`);

    if (client.secret !== undefined) {
      if (!spec.secretEnv) throw new Error(`${client.clientId} has a secret but no secretEnv`);
      client.secret = `\${${spec.secretEnv}}`;
    }
    client.redirectUris = (client.redirectUris ?? []).map((u) => toProdUrl(u, spec.urlEnv)).filter(Boolean);
    client.webOrigins = (client.webOrigins ?? []).map((u) => toProdUrl(u, spec.urlEnv)).filter(Boolean);
    // Keep only one copy of each (dev lists often repeat the prod domain already).
    client.redirectUris = [...new Set(client.redirectUris)];
    client.webOrigins = [...new Set(client.webOrigins)];
    if (client.rootUrl) client.rootUrl = toProdUrl(client.rootUrl, spec.urlEnv) ?? undefined;
    if (client.baseUrl) client.baseUrl = toProdUrl(client.baseUrl, spec.urlEnv) ?? undefined;

    const attrs = client.attributes ?? {};
    const backchannel = attrs['backchannel.logout.url'];
    if (backchannel !== undefined && isLocal(backchannel)) {
      // Notices for Firebase apps and for Central Admin itself go to the
      // Central Admin API (its bridge revokes Firebase sessions); others go to
      // the app's own backend.
      const target = /\/api\/v1\/(bridge|auth\/oidc)\//.test(backchannel)
        ? 'CENTRAL_ADMIN_API_URL'
        : (spec.backchannelEnv ?? spec.urlEnv);
      attrs['backchannel.logout.url'] = toProdUrl(backchannel, target);
    }
    for (const key of ['post.logout.redirect.uris']) {
      if (attrs[key] === undefined) continue;
      const mapped = attrs[key]
        .split('##')
        .map((u) => toProdUrl(u, spec.urlEnv))
        .filter(Boolean)
        .join('##');
      if (mapped) attrs[key] = mapped;
      else delete attrs[key];
    }
  }

  // HTTPS everywhere except loopback (Keycloak's own default for "external").
  realm.sslRequired = 'external';
  return realm;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dev = JSON.parse(readFileSync(devPath, 'utf8'));
  const text = `${JSON.stringify(makeProdRealm(dev), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = readFileSync(outPath, 'utf8');
    if (current !== text) {
      console.error('realm-slc.prod.json is out of date; run: node infra/keycloak/production/make-prod-realm.mjs');
      process.exit(1);
    }
    console.log('realm-slc.prod.json is up to date');
  } else {
    writeFileSync(outPath, text);
    console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  }
}
