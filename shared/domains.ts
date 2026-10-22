import { parse } from 'tldts';

// The WHATWG URL parser normalizes IDNA and host syntax. PSL only splits that hostname.
export function registeredDomain(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Usa una URL pública HTTP o HTTPS sin credenciales ni puertos personalizados.');
  const result = parse(url.hostname, { extractHostname: false, allowPrivateDomains: true });
  if (!result.domain || result.isIp || (!result.isIcann && !result.isPrivate)) throw new Error('Introduce un dominio público registrable, por ejemplo tienda.tunegocio.es.');
  return result.domain;
}
