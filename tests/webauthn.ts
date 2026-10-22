import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
// Tiny CBOR writer for a real ES256 software authenticator used only in tests.
function header(type: number, size: number): Buffer {
  return size < 24 ? Buffer.from([type * 32 + size]) : size < 256 ? Buffer.from([type * 32 + 24, size]) : Buffer.from([type * 32 + 25, size >> 8, size & 255]);
}
function cbor(value: unknown): Buffer {
  if (value instanceof Uint8Array) return Buffer.concat([header(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([header(3, bytes.length), bytes]); }
  if (typeof value === 'number') return header(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  const entries = value instanceof Map ? [...value] : Object.entries(value as Record<string, unknown>);
  return Buffer.concat([header(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest();
export function authenticator(origin = 'http://localhost:5173') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = randomBytes(32);
  const rpHash = hash(new URL(origin).hostname);
  const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
  let counter = 0;
  return {
    register(challenge: string) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const data = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, id.length]), id, cose]);
      return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: client.toString('base64url'), attestationObject: cbor({ fmt: 'none', attStmt: {}, authData: data }).toString('base64url'), transports: ['internal'] } };
    },
    login(challenge: string) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const count = Buffer.alloc(4); count.writeUInt32BE(++counter);
      const data = Buffer.concat([rpHash, Buffer.from([0x05]), count]);
      return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: client.toString('base64url'), authenticatorData: data.toString('base64url'), signature: sign('sha256', Buffer.concat([data, hash(client)]), privateKey).toString('base64url') } };
    },
  };
}
