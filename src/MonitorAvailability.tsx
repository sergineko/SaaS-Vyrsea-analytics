import {useState} from 'react';
import {Radio} from 'lucide-react';
import type {Monitor} from './types';
import {request} from './api';
export {MonitorAvailability} from './MonitorAvailabilityBands';
export function MonitorProbes({monitor,demo,onSaved}:{monitor:Monitor;demo:boolean;onSaved:()=>Promise<void>}){
  const [mask,setMask]=useState(monitor.probeMask??7),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  return <section className="monitor-probes"><h3><Radio size={17}/>Sondas de este monitor</h3><p>Las tres se seleccionan inicialmente. AWS y Google Cloud se aplicarán cuando sus sondas estén conectadas.</p><div className="probe-toggles">{[[1,'Cloudflare','Operativa'],[2,'AWS','Pendiente de conexión'],[4,'Google Cloud','Pendiente de conexión']].map(([bit,name,state])=><label key={bit}><input type="checkbox" checked={Boolean(mask&Number(bit))} onChange={e=>setMask(e.target.checked?mask|Number(bit):mask&~Number(bit))}/><span><strong>{name}</strong><small>{state}</small></span></label>)}</div><button className="button secondary" disabled={busy||mask===(monitor.probeMask??7)} onClick={async()=>{setBusy(true);setMessage('');try{if(!(mask&1))throw new Error('Mantén Cloudflare activa: es la única sonda conectada actualmente.');if(!demo){await request(`/monitors/${monitor.id}/probes`,'PATCH',{probeMask:mask});await onSaved();}setMessage(demo?'Preferencia de ejemplo aplicada en esta vista.':'Preferencias guardadas.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>{busy?'Guardando…':'Guardar sondas'}</button>{message&&<p role="status">{message}</p>}</section>;
}
