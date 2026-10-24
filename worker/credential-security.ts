import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { z } from 'zod';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { AppEnv } from './env';
import { nowSeconds } from './env';
import { consumeChallenge, usernameSchema, verifySafely } from './auth';
import { base64ToBytes, bytesToBase64, digest, putCookie, randomToken, rateLimit, readCookie, sessionUser, verifyTurnstile } from './security';
import { expireInactiveAccounts } from './account-policy';

export const credentialSecurity = new Hono<AppEnv>();
type C = Context<AppEnv>;
type Credential = { id: string; user_id: string; public_key: string; counter: number; transports: string };
const liveSession = 'EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?)';
const invalidRecovery = () => new HTTPException(400, { message: 'El usuario o el código de recuperación no son válidos.' });
const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();
const codeSchema = z.string().trim().max(80).transform(normalizeCode).refine(code => /^VYR[0-9A-F]{32}$/.test(code), 'Revisa el código de recuperación completo.');
async function self(c: C) {
  const user = await sessionUser(c);
  if (!user) throw new HTTPException(401, { message: 'Inicia sesión para proteger tu acceso.' });
  c.set('user', user);
  return { user, sessionHash: await digest(readCookie(c, 'session')!) };
}
async function consumeRecent(c: C, userId: string, sessionHash: string) {
  const proof = await c.env.DB.prepare('DELETE FROM recent_auth WHERE session_hash=? AND user_id=? AND expires_at>? RETURNING user_id')
    .bind(sessionHash, userId, nowSeconds()).first();
  if (!proof) throw new HTTPException(403, { message: 'Confirma tu passkey de nuevo antes de cambiar la seguridad.' });
}
export async function challenge(c: C, kind: string, value: string, userId: string, context: string) {
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO challenges(id,kind,challenge,user_id,context,expires_at) VALUES(?,?,?,?,?,?)')
    .bind(id, kind, value, userId, context, nowSeconds() + 300).run();
  putCookie(c, 'challenge', id, 300);
}
export async function registration(c: C, userId: string, username: string, exclude = true) {
  const keys = exclude ? (await c.env.DB.prepare('SELECT id FROM credentials WHERE user_id=?').bind(userId).all<{id: string}>()).results : [];
  return generateRegistrationOptions({ rpName: 'Vyrsea', rpID: new URL(c.env.APP_ORIGIN).hostname,
    userName: username, userID: new TextEncoder().encode(userId), attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: keys.map(key => ({id: key.id})),
  });
}
export async function verifyRegistration(c: C, expectedChallenge: string) {
  const response = await c.req.json<RegistrationResponseJSON>();
  const result = await verifySafely(() => verifyRegistrationResponse({ response, expectedChallenge,
    expectedOrigin: c.env.APP_ORIGIN, expectedRPID: new URL(c.env.APP_ORIGIN).hostname, requireUserVerification: true }));
  if (!result.verified || !result.registrationInfo) throw new HTTPException(400, { message: 'No se pudo verificar la nueva passkey.' });
  return result.registrationInfo.credential;
}

credentialSecurity.get('/security', async c => {
  const { user } = await self(c);
  const [keys, codes] = await Promise.all([
    c.env.DB.prepare('SELECT label,created_at AS createdAt FROM credentials WHERE user_id=? ORDER BY created_at,id').bind(user.id).all(),
    c.env.DB.prepare('SELECT COUNT(*) AS remaining,MAX(created_at) AS generatedAt FROM recovery_codes WHERE user_id=?').bind(user.id).first(),
  ]);
  return c.json({ passkeys: keys.results, recovery: codes });
});

credentialSecurity.post('/reauth/options', async c => {
  const { user, sessionHash } = await self(c);
  await rateLimit(c, 'reauth', 15, 600);
  const keys = await c.env.DB.prepare('SELECT id FROM credentials WHERE user_id=?').bind(user.id).all<{id: string}>();
  const options = await generateAuthenticationOptions({ rpID: new URL(c.env.APP_ORIGIN).hostname, userVerification: 'required', allowCredentials: keys.results.map(key => ({id: key.id})) });
  await challenge(c, 'reauth', options.challenge, user.id, sessionHash);
  return c.json(options);
});
credentialSecurity.post('/reauth/verify', async c => {
  const { user, sessionHash } = await self(c);
  await rateLimit(c, 'reauth-verify', 15, 600);
  const saved = await consumeChallenge(c, 'reauth');
  if (saved.user_id !== user.id || saved.context !== sessionHash) throw new HTTPException(403, { message: 'Confirma la passkey en la misma sesión.' });
  const response = await c.req.json<AuthenticationResponseJSON>();
  const key = await c.env.DB.prepare('SELECT * FROM credentials WHERE id=? AND user_id=?').bind(response.id ?? '', user.id).first<Credential>();
  if (!key) throw new HTTPException(400, { message: 'Utiliza una passkey de tu cuenta.' });
  const result = await verifySafely(() => verifyAuthenticationResponse({ response, expectedChallenge: saved.challenge,
    expectedOrigin: c.env.APP_ORIGIN, expectedRPID: new URL(c.env.APP_ORIGIN).hostname, requireUserVerification: true,
    credential: { id: key.id, publicKey: base64ToBytes(key.public_key), counter: key.counter } }));
  if (!result.verified) throw new HTTPException(400, { message: 'No se pudo confirmar tu identidad.' });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE credentials SET counter=? WHERE id=?').bind(result.authenticationInfo.newCounter, key.id),
    c.env.DB.prepare(`INSERT INTO recent_auth(session_hash,user_id,expires_at) SELECT ?,?,? WHERE ${liveSession}
      ON CONFLICT(session_hash) DO UPDATE SET expires_at=excluded.expires_at`)
      .bind(sessionHash, user.id, nowSeconds() + 300, sessionHash, user.id, nowSeconds()),
  ]);
  return c.json({ok: true});
});

credentialSecurity.post('/recovery-codes', async c => {
  const { user, sessionHash } = await self(c);
  await rateLimit(c, 'recovery-kit', 5, 86400);
  await consumeRecent(c, user.id, sessionHash);
  const codes = Array.from({length: 8}, () => 'VYR-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g)!.join('-'));
  const hashes = await Promise.all(codes.map(code => digest(`${user.id}:${normalizeCode(code)}`)));
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id=? AND ${liveSession}`).bind(user.id, sessionHash, user.id, nowSeconds()),
    ...hashes.map(hash => c.env.DB.prepare(`INSERT INTO recovery_codes(code_hash,user_id,created_at) SELECT ?,?,? WHERE ${liveSession}`)
      .bind(hash, user.id, nowSeconds(), sessionHash, user.id, nowSeconds())),
  ]);
  if (result[1].meta.changes !== 1) throw new HTTPException(401, { message: 'Tu sesión ha terminado. Vuelve a entrar.' });
  return c.json({codes});
});

credentialSecurity.post('/passkeys/options', async c => {
  const { user, sessionHash } = await self(c);
  await rateLimit(c, 'passkey-add', 5, 600);
  const { label } = z.object({label: z.string().trim().min(1).max(60)}).strict().parse(await c.req.json());
  await consumeRecent(c, user.id, sessionHash);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id=?').bind(user.id).first<{n: number}>();
  if (count!.n >= 5) throw new HTTPException(409, { message: 'Ya tienes cinco passkeys registradas.' });
  const options = await registration(c, user.id, user.username);
  await challenge(c, 'add-passkey', options.challenge, user.id, JSON.stringify({sessionHash, label}));
  return c.json(options);
});
credentialSecurity.post('/passkeys/verify', async c => {
  const { user, sessionHash } = await self(c);
  await rateLimit(c, 'passkey-verify', 10, 600);
  const saved = await consumeChallenge(c, 'add-passkey');
  const context = JSON.parse(saved.context ?? '{}') as {sessionHash?: string; label?: string};
  if (saved.user_id !== user.id || context.sessionHash !== sessionHash || !context.label) throw new HTTPException(403, { message: 'Añade la passkey desde la misma sesión.' });
  const key = await verifyRegistration(c, saved.challenge);
  const result = await c.env.DB.prepare(`INSERT INTO credentials(id,user_id,public_key,counter,transports,label,created_at) SELECT ?,?,?,?,?,?,? WHERE ${liveSession}`)
    .bind(key.id, user.id, bytesToBase64(key.publicKey), key.counter, JSON.stringify(key.transports ?? []), context.label, nowSeconds(), sessionHash, user.id, nowSeconds()).run();
  if (result.meta.changes !== 1) throw new HTTPException(401, { message: 'Tu sesión ha terminado. Vuelve a entrar.' });
  return c.json({ok: true}, 201);
});

credentialSecurity.post('/recovery/options', async c => {
  await rateLimit(c, 'recover', 8, 600);
  const input = z.object({username: usernameSchema, code: codeSchema, turnstileToken: z.string().optional()}).strict().parse(await c.req.json());
  await verifyTurnstile(c, input.turnstileToken, 'recover');
  const user = await c.env.DB.prepare('SELECT id,username FROM users WHERE username=?').bind(input.username).first<{id: string; username: string}>();
  const codeHash = await digest(`${user?.id ?? 'unknown'}:${input.code}`);
  const code = await c.env.DB.prepare('SELECT user_id FROM recovery_codes WHERE code_hash=? AND user_id=?').bind(codeHash, user?.id ?? '').first();
  if (!user || !code) throw invalidRecovery();
  const options = await registration(c, user.id, user.username, false);
  await challenge(c, 'recovery', options.challenge, user.id, codeHash);
  return c.json(options);
});
credentialSecurity.post('/recovery/verify', async c => {
  await rateLimit(c, 'recover-verify', 10, 600);
  const saved = await consumeChallenge(c, 'recovery');
  const key = await verifyRegistration(c, saved.challenge);
  await expireInactiveAccounts(c.env, nowSeconds(), saved.user_id);
  const token = randomToken(), sessionHash = await digest(token);
  // Every mutation is conditional on the same unused code; the batch commits atomically.
  // In particular, a competing request cannot save a key or mint a session after consumption.
  const guard = 'EXISTS(SELECT 1 FROM recovery_codes WHERE user_id=? AND code_hash=?)';
  const params = [saved.user_id, saved.context] as const;
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM credentials WHERE user_id=? AND ${guard}`).bind(saved.user_id, ...params),
    c.env.DB.prepare(`INSERT INTO credentials(id,user_id,public_key,counter,transports,label,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`)
      .bind(key.id, saved.user_id, bytesToBase64(key.publicKey), key.counter, JSON.stringify(key.transports ?? []), 'Passkey recuperada', nowSeconds(), ...params),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard}`).bind(saved.user_id, ...params),
    c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,?,? WHERE ${guard}`).bind(sessionHash, saved.user_id, nowSeconds() + 604800, ...params),
    c.env.DB.prepare(`DELETE FROM challenges WHERE user_id=? AND ${guard}`).bind(saved.user_id, ...params),
    c.env.DB.prepare('DELETE FROM recovery_codes WHERE user_id=? AND code_hash=?').bind(...params),
  ]);
  if (result[1].meta.changes !== 1) throw invalidRecovery();
  putCookie(c, 'session', token, 604800);
  return c.json({ok: true});
});
