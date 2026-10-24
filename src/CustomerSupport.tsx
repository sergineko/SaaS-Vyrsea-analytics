import {useEffect,useState} from 'react';
import {request} from './api';
import {dateTime,Modal} from './ui';
import {SupportRequestForm} from './SupportRequestForm';
import {TICKET_STATES,type SupportTicket,type SupportDetail} from '../shared/support';
import {useVisibleRefresh} from './useVisibleRefresh';
import './support.css';
export function CustomerSupport({intervalSeconds=900}:{intervalSeconds?:number}){
 const [rows,setRows]=useState<SupportTicket[]>([]),[selected,setSelected]=useState<SupportDetail|null>(null),[create,setCreate]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setRows(await request('/help/tickets'));if(selected)setSelected(await request('/help/tickets/'+selected.ticket.id));}
 useEffect(()=>{load().catch(e=>setError(e.message));},[]);useVisibleRefresh(load,!create&&!message&&!busy,intervalSeconds*1000);
 return <section className="panel support-portal"><div className="panel-heading"><div><h2>Ayuda y solicitudes</h2><p>Problemas con tu cuenta o con el servicio. Las caídas detectadas por las sondas se consultan en Incidencias.</p></div><button className="button primary" onClick={()=>setCreate(true)}>Reportar un problema</button></div>{error&&<p className="form-error" role="alert">{error}</p>}
 {!rows.length?<div className="product-empty"><h3>Tu conversación con soporte</h3><p>Abre una solicitud y conserva todas las respuestas en un mismo lugar.</p></div>:<div className="support-ticket-list">{rows.map(t=><button key={t.id} onClick={async()=>{setError('');try{setSelected(await request('/help/tickets/'+t.id));}catch(e){setError((e as Error).message);}}}><span><small>{t.publicRef}</small><strong>{t.subject}</strong><small>{dateTime(t.updatedAt)}</small></span><span className="free-tag">{TICKET_STATES[t.state]}</span></button>)}</div>}
 {create&&<Modal title="Reportar un problema" onClose={()=>setCreate(false)}><SupportRequestForm authenticated onCreated={()=>void load()}/></Modal>}
 {selected&&<Modal title={selected.ticket.publicRef+' · '+selected.ticket.subject} wide onClose={()=>{setSelected(null);setMessage('');}}><div className="support-timeline">{selected.events.map(e=><article key={e.id}><header><strong>{e.actor}</strong><time>{dateTime(e.createdAt)}</time></header><p>{e.message}</p></article>)}</div><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await request('/help/tickets/'+selected.ticket.id+'/messages','POST',{message});setMessage('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>Añadir información<textarea required minLength={2} maxLength={12000} value={message} onChange={e=>setMessage(e.target.value)}/></label><button className="button primary" disabled={busy}>{busy?'Enviando…':'Enviar respuesta'}</button></form>{error&&<p role="alert" className="form-error">{error}</p>}</Modal>}
 </section>;
}
