export type ProbeResult = { ok: boolean; statusCode: number | null; responseMs: number; error: string | null };

export function normalizeTarget(value: string): string {
  if (value.length > 2048) throw new Error('La URL es demasiado larga.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Introduce una URL completa, por ejemplo https://tuweb.es.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Usa HTTP o HTTPS con el puerto estándar y sin credenciales.');
  const host = url.hostname.toLowerCase();
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /\.(?:localhost|local|internal|invalid|test|onion|arpa|home|lan|localhost\.direct|nip\.io|sslip\.io)$/.test(host)) {
    throw new Error('Introduce un dominio público. No se admiten IP ni redes privadas.');
  }
  url.hash = '';
  return url.toString();
}

export function isPublicIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
}

export function isPublicIPv6(ip: string): boolean {
  if (!/^[23][0-9a-f]{3}:/i.test(ip) || !/^[0-9a-f:]+$/i.test(ip)) return false;
  const [first, second] = ip.toLowerCase().split(':').map(x => parseInt(x || '0', 16));
  // Global unicast only; exclude transition, benchmarking and documentation ranges.
  return first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x3fff;
}

export async function publicDNS(host: string, signal: AbortSignal, fetcher: typeof fetch) {
  const results = await Promise.all(['A', 'AAAA'].map(async type => {
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }, signal,
    });
    if (!response.ok) throw new Error('No se pudo validar el DNS.');
    const data = await response.json() as { Status: number; Answer?: { type: number; data: string }[] };
    if (data.Status !== 0) throw new Error('No se pudo resolver el dominio.');
    return data.Answer?.filter(x => x.type === 1 || x.type === 28) ?? [];
  }));
  const addresses = results.flat();
  if (!addresses.length || addresses.some(x => x.type === 1 ? !isPublicIPv4(x.data) : !isPublicIPv6(x.data))) {
    throw new Error('DNS sin direcciones públicas válidas.');
  }
}

export async function probe(target: string, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(10000);
  try {
    let url = normalizeTarget(target);
    for (let redirects = 0; redirects <= 3; redirects++) {
      await publicDNS(new URL(url).hostname, signal, fetcher);
      const response = await fetcher(url, { method: 'GET', redirect: 'manual', signal,
        headers: { 'User-Agent': 'VyrseaMonitor/0.1 (+HTTP uptime check)', Accept: '*/*', 'Cache-Control': 'no-cache' },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      await response.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (!location || redirects === 3) throw new Error('Se superó el límite de 3 redirecciones.');
        url = normalizeTarget(new URL(location, url).toString());
        continue;
      }
      return { ok: response.status >= 200 && response.status < 400, statusCode: response.status,
        responseMs: Date.now() - started, error: response.status >= 400 ? `HTTP ${response.status}` : null };
    }
    throw new Error('Demasiadas redirecciones.');
  } catch (error) {
    const timeout = signal.aborted;
    return { ok: false, statusCode: null, responseMs: Date.now() - started,
      error: timeout ? 'Tiempo de espera agotado (10 s).' : error instanceof Error ? error.message.slice(0, 180) : 'Error de conexión.' };
  }
}
