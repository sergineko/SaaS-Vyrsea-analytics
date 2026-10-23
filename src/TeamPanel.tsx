import {useEffect,useState} from 'react';
import {request} from './api';
import {dateTime,Modal} from './ui';
import {SeatBilling} from './SeatBilling';
import type {SubscriptionSeats} from '../shared/seats';
const roles={admin:'Administrador',operator:'Operador',reader:'Lector'} as const;
type Role=keyof typeof roles;
type Member={id:string;username:string;role:Role};
type Data={holder:string;subscription:SubscriptionSeats;members:Member[];invitations:{id:string;username:string;role:Role;expiresAt:number}[];audit:{actor:string;action:string;resource:string;createdAt:number}[]};
export function TeamPanel(){
 const [data,setData]=useState<Data|null>(null),[username,setUsername]=useState(''),[role,setRole]=useState<Role>('reader'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[invitation,setInvitation]=useState(''),[remove,setRemove]=useState<Member|null>(null);
 async function load(){setData(await request<Data>('/team/members'));}
 useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
 async function act(fn:()=>Promise<unknown>){setBusy(true);setMessage('');try{await fn();await load();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 const full=!!data&&data.subscription.maximum!==null&&data.subscription.users+data.subscription.pending>=data.subscription.maximum;
 return <section className="panel launch-panel">
  <div className="panel-heading"><div><span className="small-label">PRO / AGENCIA Y BUSINESS</span><h2>Equipo y permisos</h2><p>Invita a las personas que trabajan contigo y asigna el acceso que necesita cada una.</p></div></div>
  <div className="launch-content">{data&&<SeatBilling subscription={data.subscription}/>}
   <div className="launch-role-grid">{Object.entries(roles).map(([key,name])=><article key={key}><h3>{name}</h3><p>{key==='admin'?'Gestiona los monitores, las páginas de estado, las alertas y los miembros de la organización.':key==='operator'?'Consulta servicios, pausa o comprueba monitores, programa mantenimientos y publica actualizaciones de incidencias.':'Consulta los monitores y el histórico. No modifica ni publica información.'}</p></article>)}</div>
   <form className="launch-inline-form" onSubmit={e=>{e.preventDefault();void act(async()=>{const result=await request<{invitationURL:string}>('/team/invitations','POST',{username,role});setInvitation(result.invitationURL);setUsername('');});}}>
    <label>Usuario ya registrado<input required disabled={full} value={username} maxLength={60} onChange={e=>setUsername(e.target.value)} placeholder="Usuario de Vyrsea"/></label>
    <label>Rol<select value={role} onChange={e=>setRole(e.target.value as Role)}>{Object.entries(roles).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><button className="button primary" disabled={busy||!data||full}>Crear invitación</button>
   </form>{full&&<p role="status" className="status-feedback">Has reservado las 3 plazas de Pro / Agencia. Retira un miembro o cancela una invitación para liberar una plaza. Business permite ampliar el equipo.</p>}
   <p className="muted">La invitación dura 7 días, sirve una sola vez y solo puede aceptarla el usuario indicado. Comparte el enlace por un canal de confianza.</p>
   <div className="launch-list">{data&&<article><strong>{data.holder}</strong><span>Titular · 1 usuario incluido</span></article>}{data?.members.map(m=><article key={m.id}><strong>{m.username}</strong><div className="launch-actions"><select aria-label={'Rol de '+m.username} value={m.role} disabled={busy} onChange={e=>void act(()=>request('/team/members/'+m.id,'PATCH',{role:e.target.value}))}>{Object.entries(roles).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select><button className="text-button danger-text" disabled={busy} onClick={()=>setRemove(m)}>Retirar acceso</button></div></article>)}</div>
   {data?.invitations.map(i=><div className="seat-invitation" key={i.id}><span>Invitación pendiente: <strong>{i.username}</strong> · {roles[i.role]} · caduca {dateTime(i.expiresAt)}</span><button className="text-button danger-text" disabled={busy} onClick={()=>void act(()=>request('/team/invitations/'+i.id,'DELETE'))}>Cancelar invitación</button></div>)}
   <h3>Registro de cambios</h3><p className="muted">Últimas 100 acciones, con el autor de cada cambio o publicación.</p><div className="table-scroll"><table className="infrastructure-table"><thead><tr><th>Persona</th><th>Acción</th><th>Recurso</th><th>Fecha</th></tr></thead><tbody>{data?.audit.map((a,i)=><tr key={i}><th>{a.actor}</th><td>{a.action}</td><td>{a.resource}</td><td>{dateTime(a.createdAt)}</td></tr>)}</tbody></table></div>{message&&<p role="status" className="status-feedback">{message}</p>}
  </div>
  {invitation&&<Modal title="Invitación al equipo" onClose={()=>setInvitation('')}><p>Comparte este enlace con el usuario indicado.</p><input readOnly aria-label="Enlace de invitación al equipo" value={invitation} onFocus={e=>e.target.select()}/><button className="button primary" onClick={()=>setInvitation('')}>He guardado el enlace</button></Modal>}
  {remove&&<Modal title="Retirar acceso al espacio" onClose={()=>setRemove(null)}><p>{remove.username} perderá el acceso a esta organización inmediatamente. Su cuenta personal seguirá existiendo.</p><button className="button secondary" onClick={()=>setRemove(null)}>Cancelar</button><button className="button danger" disabled={busy} onClick={()=>void act(async()=>{await request('/team/members/'+remove.id,'DELETE');setRemove(null);})}>Retirar acceso</button></Modal>}
 </section>;
}
