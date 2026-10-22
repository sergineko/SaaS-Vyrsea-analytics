import { describe, expect, it } from 'vitest';
import { registeredDomain } from '../shared/domains';
describe('Domain accounting uses the Public Suffix List', () => {
  it.each([
    ['https://www.negocio.es','negocio.es'],['https://tienda.negocio.es','negocio.es'],
    ['https://a.b.negocio.es/health','negocio.es'],['https://www.example.co.uk','example.co.uk'],
    ['https://api.example.co.uk','example.co.uk'],['https://münchen.de','xn--mnchen-3ya.de'],
    ['https://alice.github.io','alice.github.io'],['https://bob.github.io','bob.github.io'],
    ['https://a.alice.github.io','alice.github.io'],
  ])('assigns %s to %s', (url, expected) => expect(registeredDomain(url)).toBe(expected));
  it.each(['https://co.uk','https://localhost','http://127.0.0.1','https://github.io','https://secret@negocio.es','file:///tmp/x'])('rejects non-registrable or unsafe inputs %s',url=>expect(()=>registeredDomain(url)).toThrow());
  it('does not group different registrable domains by a textual suffix',()=>expect(registeredDomain('https://negocio.es.evil.com')).toBe('evil.com'));
});
