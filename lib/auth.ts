import crypto from 'node:crypto';

// Shared-login session, signed with AUTH_SECRET. No database or external deps —
// the cookie value is its own proof (HMAC), so we never store anything server-side.

export const SESSION_COOKIE = 'sv_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

const SECRET = process.env.AUTH_SECRET ?? '';

function sign(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

/** Build a signed token of the form `<base64url(payload)>.<signature>`. */
export function createSessionToken(username: string): string {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const encoded = Buffer.from(`${username}.${expires}`).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

/** Returns true only if the token is well-formed, correctly signed, and unexpired. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token || !SECRET) return false;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const expires = Number(Buffer.from(encoded, 'base64url').toString().split('.')[1]);
    return Number.isFinite(expires) && Date.now() < expires;
  } catch {
    return false;
  }
}
