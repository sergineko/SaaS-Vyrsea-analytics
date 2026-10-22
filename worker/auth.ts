import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import type { AppEnv } from './env';
import { nowSeconds } from './env';
import { base64ToBytes, bytesToBase64, clearCookie, digest, newSession, putCookie, rateLimit, readCookie, sessionUser, verifyTurnstile } from './security';

export const auth = new Hono<AppEnv>();
const usernameSchema = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9][a-z0-9_.-]+$/, 'Usa letras, números, puntos o guiones.');
type Challenge = { kind: string; challenge: string; user_id: string; username: string };
async function verifySafely<T>(verify: () => Promise<T>): Promise<T> {
  try { return await verify(); }
  catch { throw new HTTPException(400, { message: 'La passkey no es válida para esta solicitud. Vuelve a intentarlo.' }); }
}
async function consumeChallenge(c: Parameters<typeof sessionUser>[0], kind: string) {
  const id = readCookie(c, 'challenge');
  clearCookie(c, 'challenge');
  const row = id ? await c.env.DB.prepare('DELETE FROM challenges WHERE id=? AND expires_at>? RETURNING *').bind(id, nowSeconds()).first<Challenge>() : null;
  if (!row || row.kind !== kind) throw new HTTPException(400, { message: 'La solicitud ha caducado. Vuelve a intentarlo.' });
  return row;
}

auth.post('/register/options', async c => {
  await rateLimit(c, 'register', 5, 600);
  const input = z.object({ username: usernameSchema, turnstileToken: z.string().optional() }).parse(await c.req.json());
  await verifyTurnstile(c, input.turnstileToken);
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username=?').bind(input.username).first();
  if (existing) throw new HTTPException(409, { message: 'Ese nombre de usuario ya está ocupado.' });
  const userId = crypto.randomUUID();
  const options = await generateRegistrationOptions({ rpName: 'Vyrsea', rpID: new URL(c.env.APP_ORIGIN).hostname,
    userName: input.username, userID: new TextEncoder().encode(userId), attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257], authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO challenges(id,kind,challenge,user_id,username,expires_at) VALUES(?,?,?,?,?,?)')
    .bind(challengeId, 'register', options.challenge, userId, input.username, nowSeconds() + 300).run();
  putCookie(c, 'challenge', challengeId, 300);
  return c.json(options);
});

auth.post('/register/verify', async c => {
  await rateLimit(c, 'verify', 15, 600);
  const saved = await consumeChallenge(c, 'register');
  const body = await c.req.json<RegistrationResponseJSON>();
  const result = await verifySafely(() => verifyRegistrationResponse({ response: body, expectedChallenge: saved.challenge,
    expectedOrigin: c.env.APP_ORIGIN, expectedRPID: new URL(c.env.APP_ORIGIN).hostname, requireUserVerification: true }));
  if (!result.verified || !result.registrationInfo) throw new HTTPException(400, { message: 'No se pudo verificar la passkey.' });
  const { credential } = result.registrationInfo;
  const session = await newSession(c, saved.user_id);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users(id,username,created_at) VALUES(?,?,?)').bind(saved.user_id, saved.username, nowSeconds()),
    c.env.DB.prepare('INSERT INTO credentials(id,user_id,public_key,counter,transports) VALUES(?,?,?,?,?)')
      .bind(credential.id, saved.user_id, bytesToBase64(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? [])),
    session.statement,
  ]);
  session.commitCookie();
  return c.json({ ok: true }, 201);
});

auth.post('/login/options', async c => {
  await rateLimit(c, 'login', 15, 600);
  const options = await generateAuthenticationOptions({ rpID: new URL(c.env.APP_ORIGIN).hostname, userVerification: 'required' });
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO challenges(id,kind,challenge,expires_at) VALUES(?,?,?,?)').bind(id, 'login', options.challenge, nowSeconds() + 300).run();
  putCookie(c, 'challenge', id, 300);
  return c.json(options);
});

auth.post('/login/verify', async c => {
  await rateLimit(c, 'verify', 15, 600);
  const saved = await consumeChallenge(c, 'login');
  const body = await c.req.json<AuthenticationResponseJSON>();
  const credential = await c.env.DB.prepare('SELECT * FROM credentials WHERE id=?').bind(body.id ?? '').first<{ id: string; user_id: string; public_key: string; counter: number; transports: string }>();
  if (!credential) throw new HTTPException(400, { message: 'No se reconoce esta passkey.' });
  const result = await verifySafely(() => verifyAuthenticationResponse({ response: body, expectedChallenge: saved.challenge,
    expectedOrigin: c.env.APP_ORIGIN, expectedRPID: new URL(c.env.APP_ORIGIN).hostname, requireUserVerification: true,
    credential: { id: credential.id, publicKey: base64ToBytes(credential.public_key), counter: credential.counter },
  }));
  if (!result.verified) throw new HTTPException(400, { message: 'No se pudo verificar el acceso.' });
  const session = await newSession(c, credential.user_id);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE credentials SET counter=? WHERE id=?').bind(result.authenticationInfo.newCounter, credential.id), session.statement,
  ]);
  session.commitCookie();
  return c.json({ ok: true });
});

auth.post('/logout', async c => {
  const token = readCookie(c, 'session');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  clearCookie(c, 'session');
  return c.json({ ok: true });
});
