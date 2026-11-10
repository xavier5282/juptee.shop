const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 16_384;
const CERTIFICATE_CACHE_TTL_MS = 5 * 60 * 1000;
const certificateCache = new Map();

class AccessConfigurationError extends Error {}
class AccessTokenError extends Error {}
class AccessCertificateError extends Error {}

function accessConfig(env, audienceVariable) {
  const rawDomain = typeof env.CF_ACCESS_TEAM_DOMAIN === 'string'
    ? env.CF_ACCESS_TEAM_DOMAIN.trim()
    : '';
  const rawAudiences = typeof env[audienceVariable] === 'string' ? env[audienceVariable] : '';
  if (!rawDomain || !rawAudiences.trim()) {
    throw new AccessConfigurationError(`CF_ACCESS_TEAM_DOMAIN and ${audienceVariable} must both be configured.`);
  }

  let teamUrl;
  try {
    teamUrl = new URL(rawDomain.includes('://') ? rawDomain : `https://${rawDomain}`);
  } catch {
    throw new AccessConfigurationError('CF_ACCESS_TEAM_DOMAIN must be a valid HTTPS Access team domain.');
  }
  if (teamUrl.protocol !== 'https:' || teamUrl.username || teamUrl.password
    || (teamUrl.pathname !== '/' && teamUrl.pathname !== '') || teamUrl.search || teamUrl.hash) {
    throw new AccessConfigurationError('CF_ACCESS_TEAM_DOMAIN must contain only the HTTPS Access team domain.');
  }

  const audiences = rawAudiences.split(',').map(value => value.trim()).filter(Boolean);
  if (!audiences.length) {
    throw new AccessConfigurationError(`${audienceVariable} must contain at least one Access application audience tag.`);
  }

  let allowedEmails;
  if (env.CF_ACCESS_ALLOWED_EMAILS !== undefined) {
    if (typeof env.CF_ACCESS_ALLOWED_EMAILS !== 'string') {
      throw new AccessConfigurationError('CF_ACCESS_ALLOWED_EMAILS must be a comma-separated email list.');
    }
    allowedEmails = env.CF_ACCESS_ALLOWED_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!allowedEmails.length || allowedEmails.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      throw new AccessConfigurationError('CF_ACCESS_ALLOWED_EMAILS must contain one or more valid email addresses.');
    }
  }

  return {
    issuer: teamUrl.origin,
    audienceVariable,
    audiences,
    allowedEmails
  };
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AccessTokenError('Malformed JWT encoding.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new AccessTokenError('Malformed JWT encoding.');
  }
}

function decodeJson(value) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(value)));
  } catch {
    throw new AccessTokenError('Malformed JWT JSON.');
  }
}

async function accessKeys(issuer, forceRefresh = false) {
  const cached = certificateCache.get(issuer);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) return cached.keys;

  let response;
  try {
    response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new AccessCertificateError('Could not reach the Cloudflare Access certificate endpoint.');
  }
  if (!response.ok) {
    throw new AccessCertificateError(`Cloudflare Access certificates returned HTTP ${response.status}.`);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new AccessCertificateError('Cloudflare Access returned invalid certificate data.');
  }
  if (!Array.isArray(result?.keys) || !result.keys.length) {
    throw new AccessCertificateError('Cloudflare Access returned no verification keys.');
  }
  certificateCache.set(issuer, {
    keys: result.keys,
    expiresAt: Date.now() + CERTIFICATE_CACHE_TTL_MS
  });
  return result.keys;
}

function tokenParts(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    throw new AccessTokenError('Missing or oversized Access JWT.');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new AccessTokenError('Malformed Access JWT.');
  }
  return parts;
}

async function verifyAccessToken(token, config) {
  const [encodedHeader, encodedClaims, encodedSignature] = tokenParts(token);
  const header = decodeJson(encodedHeader);
  const claims = decodeJson(encodedClaims);
  const now = Math.floor(Date.now() / 1000);
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new AccessTokenError('JWT header must use RS256 and include a key ID.');
  }
  if (claims.iss !== config.issuer) throw new AccessTokenError('JWT issuer does not match the configured Access team.');
  if (!tokenAudiences.some(audience => typeof audience === 'string' && config.audiences.includes(audience))) {
    throw new AccessTokenError(`JWT audience does not match ${config.audienceVariable}.`);
  }
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp <= claims.iat) {
    throw new AccessTokenError('JWT is expired or has an invalid expiration claim.');
  }
  if (!Number.isSafeInteger(claims.iat) || claims.iat > now + CLOCK_SKEW_SECONDS) {
    throw new AccessTokenError('JWT issued-at claim is missing or invalid.');
  }
  if (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + CLOCK_SKEW_SECONDS)) {
    throw new AccessTokenError('JWT is not yet valid.');
  }
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new AccessTokenError('JWT subject claim is missing.');
  }

  let keys = await accessKeys(config.issuer);
  let jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) {
    keys = await accessKeys(config.issuer, true);
    jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  }
  if (!jwk) throw new AccessTokenError('Access JWT signing key was not found.');

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch {
    throw new AccessCertificateError('Cloudflare Access supplied an unusable verification key.');
  }

  let validSignature;
  try {
    validSignature = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
    );
  } catch {
    throw new AccessTokenError('Access JWT signature is invalid.');
  }
  if (!validSignature) throw new AccessTokenError('Access JWT signature is invalid.');

  if (config.allowedEmails) {
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email || !config.allowedEmails.includes(email)) return { authorized: false };
  }

  return { authorized: true };
}

function adminAudienceVariable(pathname) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'CF_ACCESS_ADMIN_AUD';
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) return 'CF_ACCESS_API_AUD';
  return null;
}

function response(message, status) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function adminLoginRedirect(url) {
  const loginUrl = new URL('/login.html', url);
  loginUrl.searchParams.set('returnTo', `${url.pathname}${url.search}`);
  return new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': 'no-store',
      Location: loginUrl.toString()
    }
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const audienceVariable = adminAudienceVariable(url.pathname);
  if (!audienceVariable) return context.next();

  let config;
  try {
    config = accessConfig(context.env, audienceVariable);
  } catch (error) {
    console.error('Admin authentication configuration error:', error.message);
    return response(`Administrator authentication is not configured. Set CF_ACCESS_TEAM_DOMAIN and ${audienceVariable} in the production Pages environment.`, 503);
  }
  const token = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return new Response('Administrator access required.', {
      status: 401,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  let result;
  try {
    result = await verifyAccessToken(token, config);
  } catch (error) {
    if (error instanceof AccessTokenError) {
      return response('Administrator access required.', 401);
    }
    console.error('Cloudflare Access verification failed:', error);
    return new Response('Administrator authentication is temporarily unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
  if (!result.authorized) {
    return response('Administrator access denied.', 403);
  }

  const pageResponse = await context.next();
  const headers = new Headers(pageResponse.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(pageResponse.body, { status: pageResponse.status, statusText: pageResponse.statusText, headers });
}
