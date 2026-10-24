import { useState, type FormEvent } from 'react';
import type { OwnerAccount } from '../shared/accounts';
import { PLAN_CATALOG, intervalLabel, type PlanId } from '../shared/plans';
import { request } from './api';
import { Modal } from './ui';

export function OwnerPlanForm({account,onClose,onSaved,embedded=false}:{account:OwnerAccount;onClose:()=>void;onSaved:()=>Promise<void>;embedded?:boolean}) {
  const [plan,setPlan]=useState<PlanId>(account.planId as PlanId),[domains,setDomains]=useState(account.domainLimit??20),[monitors,setMonitors]=useState(account.monitorLimit??100),[days,setDays]=useState(account.historyDaysLimit??90);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const selected=PLAN_CATALOG.find(item=>item.id===plan)!;
  async function save(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {await request(`/owner/accounts/${account.id}/plan`,'PATCH',{planId:plan,...(plan==='business'?{domainLimit:domains,monitorLimit:monitors,historyDaysLimit:days}:{})});await onSaved();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  const content=<form onSubmit={save}><p className="muted">Asignación manual de acceso. No crea pagos, tarjetas ni suscripciones. El estado de aprobación se mantiene.</p><label>Plan de la cuenta<select value={plan} onChange={event=>setPlan(event.target.value as PlanId)}>{PLAN_CATALOG.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {plan==='business'?<div className="owner-plan-fields"><label>Máximo de dominios<input type="number" min={1} max={1000000} required value={domains} onChange={event=>setDomains(Number(event.target.value))}/></label><label>Máximo de monitores<input type="number" min={1} max={1000000} required value={monitors} onChange={event=>setMonitors(Number(event.target.value))}/></label><label>Días de histórico<input type="number" min={1} max={365} required value={days} onChange={event=>setDays(Number(event.target.value))}/></label></div>:<p className="settings-note">{selected.maxDomains} dominios · {selected.maxMonitors} monitores · {selected.historyDays} días de histórico.</p>}
    <p className="settings-note">Comprobaciones cada {intervalLabel(selected.intervalSeconds)}. El límite técnico de la beta para cuentas de clientes sigue siendo compartido; una cuota de plan mayor no amplía Cloudflare Free.</p><p className="settings-note">Reducir una cuota no elimina monitores. Reducir el histórico aplica la nueva retención y puede eliminar muestras antiguas durante la limpieza.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="access-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy?'Guardando…':'Guardar plan y cuotas'}</button></div></form>;return embedded?content:<Modal title={`Plan de ${account.username}`} onClose={()=>{if(!busy)onClose();}}>{content}</Modal>;
}
