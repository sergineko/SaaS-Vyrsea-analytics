import { describe, expect, it, vi } from 'vitest';
import { isPublicIPv4, isPublicIPv6, normalizeTarget, probe } from '../worker/probe';

describe('Outbound HTTP safety', () => {
  it.each(['http://localhost', 'https://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://user:secret@site.com', 'https://site.com:8443', 'file:///etc/passwd', 'https://private.local', 'http://a.nip.io', 'http://metadata.google.internal'])('blocks unsafe URL %s', value => {
    expect(() => normalizeTarget(value)).toThrow();
  });
  it('normalizes a public HTTP URL', () => expect(normalizeTarget('https://Example.com/path#private')).toBe('https://example.com/path'));
  it.each(['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '203.0.113.1', '224.0.0.1', '255.255.255.255'])('blocks private/reserved IPv4 %s', ip => expect(isPublicIPv4(ip)).toBe(false));
  it.each(['::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::', '3fff::1'])('blocks private/reserved IPv6 %s', ip => expect(isPublicIPv6(ip)).toBe(false));
  it('accepts public DNS addresses', () => { expect(isPublicIPv4('1.1.1.1')).toBe(true); expect(isPublicIPv6('2606:4700:4700::1111')).toBe(true); });
  it('rejects private DNS before contacting the target', async () => {
    const mock = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] }));
    const result = await probe('https://example.com', mock as typeof fetch);
    expect(result.ok).toBe(false); expect(result.error).toContain('DNS');
    expect(mock.mock.calls).toHaveLength(2);
  });
  it('rejects an unsafe AAAA alongside a public IPv4', async () => {
    const mock = vi.fn(async (url: string) => Response.json({ Status: 0, Answer: [{ type: url.includes('AAAA') ? 28 : 1, data: url.includes('AAAA') ? '::1' : '1.1.1.1' }] }));
    expect((await probe('https://example.com', mock as typeof fetch)).ok).toBe(false);
    expect(mock.mock.calls).toHaveLength(2);
  });
  it('validates redirect destinations and never follows an internal URL', async () => {
    const visited: string[] = [];
    const mock = async (url: string) => { visited.push(url); return url.includes('dns-query') ? Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }) : new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }); };
    expect((await probe('https://example.com', mock as typeof fetch)).ok).toBe(false);
    expect(visited.some(url => url.includes('/admin'))).toBe(false);
  });
  it('records HTTP failures and cancels the response stream', async () => {
    let canceled = false;
    const mock = async (url: string) => url.includes('dns-query') ? Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }) : new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 503 });
    const result = await probe('https://example.com', mock as typeof fetch);
    expect(result.statusCode).toBe(503); expect(result.error).toBe('HTTP 503'); expect(canceled).toBe(true);
  });
  it('bounds redirects to three hops', async () => {
    let requests = 0;
    const mock = async (url: string) => { if (url.includes('dns-query')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }); requests++; return new Response(null, { status: 301, headers: { Location: '/loop' } }); };
    expect((await probe('https://example.com', mock as typeof fetch)).error).toContain('3 redirecciones');
    expect(requests).toBe(4);
  });
});
