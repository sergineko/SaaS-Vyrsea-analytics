import {useState} from 'react';
import type {OwnerAccount} from '../shared/accounts';
import {request} from './api';
import {confirmPasskey} from './reauth';
export function SupportAccessControl({account,onSaved}:{account:OwnerAccount;onSaved:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 if(account.isOwner)return <p>Esta cuenta ya dispone de acceso completo al CRM de soporte.</p>;
 return <section className="support-access"><h3>Equipo de soporte de Vyrsea</h3><p>Permiso global para consultar tickets y contactos, responder y dejar notas internas. No permite modificar planes, precios, infraestructura ni autorizar recuperaciones. Es independiente del equipo de una organización cliente.</p><p>Estado: <strong>{account.isSupport?'Agente de soporte':'Sin acceso al CRM'}</strong></p><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{await confirmPasskey();await request('/support/staff/'+account.id,'PUT',{enabled:!account.isSupport});await onSaved();setMessage('Permiso de soporte actualizado. Queda registrado en la auditoría.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>{busy?'Confirma tu passkey…':account.isSupport?'Retirar permiso de soporte':'Conceder permiso de soporte'}</button>{message&&<p role="status">{message}</p>}</section>;
}
