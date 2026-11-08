let keyCache;
let keyCacheUntil = 0;

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function accessKeys(teamDomain) {
  if (keyCache && Date.now() < keyCacheUntil) return keyCache;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Cloudflare Access certificates returned ${response.status}`);
  keyCache = await response.json();
  keyCacheUntil = Date.now() + 5 * 60 * 1000;
  return keyCache;
}

async function validAccessToken(token, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (header.alg !== 'RS256'
    || claims.iss !== `https://${env.CF_ACCESS_TEAM_DOMAIN}`
    || !env.CF_ACCESS_AUD.split(',').map(value => value.trim()).some(expected => audience.includes(expected))
    || !Number.isFinite(claims.exp)
    || claims.exp <= now
    || (claims.nbf && claims.nbf > now)) return false;

  const keys = await accessKeys(env.CF_ACCESS_TEAM_DOMAIN);
  const jwk = keys.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/admin') && !url.pathname.startsWith('/api/admin/')) {
    return context.next();
  }

  const token = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return new Response('Administrator access required.', {
      status: 401,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  let valid = false;
  try {
    valid = await validAccessToken(token, context.env);
  } catch (error) {
    console.error('Cloudflare Access verification failed:', error);
    return new Response('Administrator authentication is temporarily unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
  if (!valid) {
    return new Response('Administrator access required.', {
      status: 401,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}
