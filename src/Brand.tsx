import { Activity } from 'lucide-react';
export function Logo({ light = false }: { light?: boolean }) {
  return <a className={`brand ${light ? 'light' : ''}`} href="/" aria-label="Vyrsea, inicio"><span className="brand-mark"><Activity size={25} strokeWidth={2.2} aria-hidden="true" /></span>vyrsea</a>;
}
