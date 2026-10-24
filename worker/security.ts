import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, User } from './env';
import { nowSeconds } from './env';
import { expireInactiveAccounts, INACTIVITY_CUTOFF } from './account-policy';

export const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const base64ToBytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export const randomToken = () => bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export async function digest(value: string) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function cookieName(c: Context<AppEnv>, name: string) {
  return `${c.env.APP_ORIGIN.startsWith('https:') ? '__Host-' : ''}pulso_${name}`;
}
export function putCookie(c: Context<AppEnv>, name: string, value: string, maxAge: number) {
  setCookie(c, cookieName(c, name), value, { httpOnly: true, secure: c.env.APP_ORIGIN.startsWith('https:'), sameSite: 'Strict', path: '/', maxAge });
}
export function readCookie(c: Context<AppEnv>, name: string) { return getCookie(c, cookieName(c, name)); }
export function clearCookie(c: Context<AppEnv>, name: string) { deleteCookie(c, cookieName(c, name), { path: '/', secure: c.env.APP_ORIGIN.startsWith('https:') }); }
export const isLocal = (origin: string) => /^http:\/\/localhost(?::\d+)?$/.test(origin);

export async function sessionUser(c: Context<AppEnv>): Promise<User | null> {
  const token = readCookie(c, 'session');
  if (!token) return null;
  const statement = c.env.DB.prepare(`SELECT u.id,u.username,u.created_at AS createdAt,u.account_status AS accountStatus,u.is_owner AS isOwner,u.owner_apply_plan AS ownerApplyPlan,
    EXISTS(SELECT 1 FROM platform_staff ps WHERE ps.user_id=u.id) AS isSupport,
    u.plan_id AS planId,u.last_active_at AS lastActiveAt,u.suspension_reason AS suspensionReason,u.review_requested_at AS reviewRequestedAt
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await digest(token), nowSeconds());
  let user = await statement.first<User>();
  if (user?.accountStatus === 'active' && user.planId === 'free' && !user.isOwner && user.lastActiveAt < nowSeconds() - INACTIVITY_CUTOFF) {
    await expireInactiveAccounts(c.env, nowSeconds(), user.id);
    user = await statement.first<User>();
  }
  return user ? { ...user, isOwner: Boolean(user.isOwner),isSupport:Boolean(user.isSupport),ownerApplyPlan:Boolean(user.ownerApplyPlan) } : null;
}
export async function newSession(c: Context<AppEnv>, userId: string, credentialId?: string) {
  const token = randomToken();
  // Recheck inside the login transaction: recovery may revoke a key while its signature is being verified.
  const values = [await digest(token), userId, nowSeconds() + 604800];
  const statement = credentialId
    ? c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM credentials WHERE id=? AND user_id=?)').bind(...values, credentialId, userId)
    : c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(...values);
  return { statement, commitCookie: () => putCookie(c, 'session', token, 604800) };
}
export async function rateLimit(c: Context<AppEnv>, scope: string, limit: number, windowSeconds: number) {
  const timestamp = nowSeconds();
  const identity = c.get('user')?.id ?? c.req.header('CF-Connecting-IP') ?? 'local';
  const key = `${scope}:${await digest(identity)}:${Math.floor(timestamp / windowSeconds)}`;
  const row = await c.env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count')
    .bind(key, timestamp + windowSeconds).first<{ count: number }>();
  if (!row || row.count > limit) throw new HTTPException(429, { message: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.' });
}
export async function verifyTurnstile(c: Context<AppEnv>, token?: string, action = 'register') {
  if (!c.env.TURNSTILE_SECRET_KEY && isLocal(c.env.APP_ORIGIN)) return;
  if (!c.env.TURNSTILE_SECRET_KEY || !c.env.TURNSTILE_SITE_KEY) throw new HTTPException(503, { message: 'El registro estará disponible cuando se configure Turnstile.' });
  if (!token || token.length > 2048) throw new HTTPException(400, { message: 'Completa la verificación de seguridad.' });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ secret: c.env.TURNSTILE_SECRET_KEY, response: token, remoteip: c.req.header('CF-Connecting-IP') }),
  });
  const result = await response.json() as { success: boolean; hostname: string; action: string };
  if (!result.success || result.hostname !== new URL(c.env.APP_ORIGIN).hostname || result.action !== action) {
    throw new HTTPException(400, { message: 'No se pudo verificar la seguridad. Vuelve a intentarlo.' });
  }
}
