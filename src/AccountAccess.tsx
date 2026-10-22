import { useState } from 'react';
import { Clock3, LogOut, PauseCircle, RefreshCw } from 'lucide-react';
import { Logo } from './Brand';
import { request } from './api';
import type { User } from './types';
import './account-access.css';

export function AccountAccess({ user, onRefresh, onExit }: { user: User; onRefresh: () => Promise<void>; onExit: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = user.accountStatus === 'pending';
  async function action(review = false) {
    setBusy(true); setError('');
    try { if (review) await request('/account/review', 'POST'); await onRefresh(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <main className="access-page"><Logo /><section className="access-card">
    <span className="access-symbol">{pending ? <Clock3 size={28} /> : <PauseCircle size={28} />}</span>
    <p className="small-label">BETA CON ACCESO SUPERVISADO</p>
    <h1>{pending ? 'Solicitud recibida' : 'Tu cuenta está suspendida'}</h1>
    <p>{pending ? 'El propietario revisará tu acceso antes de activar la monitorización. Tu passkey ya está guardada: podrás volver a entrar con ella.' : user.suspensionReason === 'inactivity' ? 'Han pasado más de 14 días sin actividad en tu cuenta Free. Las sondas se han detenido para liberar consumo de la plataforma.' : 'El propietario ha suspendido temporalmente el acceso y las comprobaciones de esta cuenta.'}</p>
    <dl><div><dt>Usuario</dt><dd>{user.username}</dd></div><div><dt>Estado</dt><dd>{pending ? 'Pendiente de aprobación' : user.reviewRequestedAt ? 'Reactivación solicitada' : 'Sondas detenidas'}</dd></div></dl>
    {!pending && <p className="access-note">Tus monitores se conservan y el histórico sigue sujeto a la retención de tu plan{user.planId === 'free' ? ' (7 días)' : ''}. El propietario debe aprobar la reactivación; iniciar sesión no la activa automáticamente.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="access-actions">{!pending && !user.reviewRequestedAt && <button className="button primary" disabled={busy} onClick={() => action(true)}>Solicitar reactivación</button>}<button className="button secondary" disabled={busy} onClick={() => action()}><RefreshCw size={15} />Comprobar estado</button><button className="text-button" disabled={busy} onClick={() => { setBusy(true); onExit().catch(error => { setError(error.message); setBusy(false); }); }}><LogOut size={15} />Cerrar sesión</button></div>
    {pending && <p className="access-note">Free incluye 1 dominio y 2 monitores, con comprobaciones cada 15 minutos. La activación está sujeta a la capacidad de esta beta.</p>}
  </section></main>;
}
