import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const issuer = 'https://juptee-team.cloudflareaccess.com';
const audience = 'juptee-admin-audience';
const kid = 'test-access-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, kty: 'RSA', alg: 'RS256', use: 'sig' };
const originalFetch = globalThis.fetch;
const source = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

after(() => {
  globalThis.fetch = originalFetch;
});

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function makeToken(claimOverrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT', ...headerOverrides };
  const claims = {
    iss: issuer,
    aud: audience,
    sub: 'access-user-id',
    email: 'admin@example.com',
    iat: now - 5,
    exp: now + 300,
    ...claimOverrides
  };
  const content = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

function setCertificateResponse() {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
  };
  return calls;
}

function context(path, { token, env = {}, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('Cf-Access-Jwt-Assertion', token);
  let nextCalled = false;
  return {
    value: {
      request: new Request(`https://juptee.shop${path}`, { headers: requestHeaders }),
      env,
      next: async () => {
        nextCalled = true;
        return new Response('ok');
      }
    },
    nextCalled: () => nextCalled
  };
}

const validEnv = {
  CF_ACCESS_TEAM_DOMAIN: 'juptee-team.cloudflareaccess.com',
  CF_ACCESS_AUD: audience
};

test('allows an Access-signed JWT with a configured audience and official issuer keys', async () => {
  const calls = setCertificateResponse();
  const ctx = context('/admin/dashboard.js', {
    token: makeToken({ aud: ['other-audience', audience] }),
    env: { ...validEnv, CF_ACCESS_AUD: `other-configured-audience, ${audience}` }
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(ctx.nextCalled(), true);
  assert.equal(calls[0].url, `${issuer}/cdn-cgi/access/certs`);
  assert.equal(calls[0].options.headers.Accept, 'application/json');
});

test('returns 401 for a missing token and ignores user-supplied identity headers', async () => {
  setCertificateResponse();
  const ctx = context('/api/admin/products', {
    env: validEnv,
    headers: { 'X-User-Email': 'admin@example.com' }
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 401);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 401 for an invalid JWT signature', async () => {
  setCertificateResponse();
  const token = makeToken();
  const parts = token.split('.');
  parts[2] = base64Url('not-a-valid-signature');
  const ctx = context('/admin', { token: parts.join('.'), env: validEnv });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 401);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 401 when the audience does not match any configured application', async () => {
  setCertificateResponse();
  const ctx = context('/api/admin/settings', {
    token: makeToken({ aud: ['another-application'] }),
    env: validEnv
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 401);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 401 when the issuer does not match the configured Access team', async () => {
  setCertificateResponse();
  const ctx = context('/admin', {
    token: makeToken({ iss: 'https://another-team.cloudflareaccess.com' }),
    env: validEnv
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 401);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 401 for an expired JWT', async () => {
  setCertificateResponse();
  const now = Math.floor(Date.now() / 1000);
  const ctx = context('/admin', {
    token: makeToken({ iat: now - 600, exp: now - 1 }),
    env: validEnv
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 401);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 403 for a valid Access identity outside the optional administrator allowlist', async () => {
  setCertificateResponse();
  const ctx = context('/api/admin/orders', {
    token: makeToken({ email: 'not-an-admin@example.com' }),
    env: { ...validEnv, CF_ACCESS_ALLOWED_EMAILS: 'admin@example.com' }
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 403);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 503 with a configuration diagnostic when required variables are missing', async () => {
  const ctx = context('/admin', { env: {} });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD/);
  assert.equal(ctx.nextCalled(), false);
});

test('returns 503 when Cloudflare Access public keys cannot be fetched', async () => {
  globalThis.fetch = async () => { throw new Error('network unavailable'); };
  const offlineIssuer = 'https://offline-team.cloudflareaccess.com';
  const ctx = context('/admin', {
    token: makeToken({ iss: offlineIssuer }),
    env: { ...validEnv, CF_ACCESS_TEAM_DOMAIN: 'offline-team.cloudflareaccess.com' }
  });

  const response = await onRequest(ctx.value);
  assert.equal(response.status, 503);
  assert.equal(ctx.nextCalled(), false);
});

test('does not apply administrator authentication to public routes and preserves Access 403 responses', async () => {
  const publicContext = context('/api/products', { env: {} });
  assert.equal((await onRequest(publicContext.value)).status, 200);
  assert.equal(publicContext.nextCalled(), true);

  setCertificateResponse();
  const deniedContext = context('/admin', { token: makeToken(), env: validEnv });
  deniedContext.value.next = async () => new Response('Access policy denied', { status: 403 });
  const deniedResponse = await onRequest(deniedContext.value);
  assert.equal(deniedResponse.status, 403);
});
