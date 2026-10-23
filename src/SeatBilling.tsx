import {useEffect,useState} from 'react';
import {euros,seatTerms,type SubscriptionSeats} from '../shared/seats';
import {request} from './api';
export function SeatBilling({subscription}:{subscription:SubscriptionSeats}){
 const {billing,users,pending,maximum,plan}=subscription,cycle=billing.cycle==='yearly'?'año':'mes';
 return <div className="seat-summary"><header><div><span className="small-label">USUARIOS DE LA ORGANIZACIÓN</span><h3>{users} {users===1?'usuario':'usuarios'}{maximum!==null&&<> de {maximum}</>}</h3></div><span className="billing-status">Pagos deshabilitados</span></header><p>{seatTerms(plan)}.</p><dl><div><dt>Precio base · incluye 1 usuario</dt><dd>{billing.baseCents===null?'Por acordar':euros(billing.baseCents)+'/'+cycle}</dd></div><div><dt>{Math.max(0,users-1)} usuarios adicionales</dt><dd>{euros(billing.seatCents)}/{cycle}</dd></div><div><dt>Referencia total</dt><dd>{billing.totalCents===null?'Base por acordar + '+euros(billing.seatCents)+'/'+cycle:euros(billing.totalCents)+'/'+cycle}</dd></div></dl><p className="muted">{billing.exempt?'Esta cuenta tiene acceso sin cobros. ':`Cada usuario adicional: ${euros(billing.unitCents)}/mes${billing.cycle==='yearly'?' (12 meses en el importe anual)':''}. `}{pending>0?`${pending} invitaciones pendientes reservan plaza y no se incluyen en el importe. `:''}Los importes son informativos; no se crea ninguna suscripción.</p></div>;
}
export function SubscriptionSeatsPanel(){
 const [data,setData]=useState<SubscriptionSeats|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;request<{subscription:SubscriptionSeats}>('/subscription').then(r=>{if(active)setData(r.subscription);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return data?<SeatBilling subscription={data}/>:<p role="status" className="muted">{error||'Consultando usuarios y condiciones…'}</p>;
}
