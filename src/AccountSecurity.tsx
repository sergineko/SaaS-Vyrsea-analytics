import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Download, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import { request } from './api';
import './account-security.css';
type Security = {passkeys: {label:string;createdAt:number}[];recovery:{remaining:number;generatedAt:number|null}};

export default function AccountSecurity({username}:{username:string}) {
  const [data,setData]=useState<Security|null>(null),[label,setLabel]=useState('Passkey de respaldo'),[codes,setCodes]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function refresh(){setData(await request<Security>('/auth/security'));}
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  async function reauthenticate(){
    const options=await request<PublicKeyCredentialRequestOptionsJSON>('/auth/reauth/options','POST');
    await request('/auth/reauth/verify','POST',await startAuthentication({optionsJSON:options}));
  }
  async function act(kind:'kit'|'passkey'){
    setBusy(true);setError('');setMessage('');setCodes([]);
    try{
      await reauthenticate();
      if(kind==='kit'){
        const result=await request<{codes:string[]}>('/auth/recovery-codes','POST');setCodes(result.codes);
        setMessage('Kit creado. Guárdalo ahora: los códigos no se volverán a mostrar.');
      }else{
        const options=await request<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/options','POST',{label});
        await request('/auth/passkeys/verify','POST',await startRegistration({optionsJSON:options}));
        setMessage('Passkey añadida. Ya puedes usarla para iniciar sesión.');
      }
      await refresh();
    }catch(e){setError((e as Error).name==='NotAllowedError'?'Se ha cancelado la confirmación. Puedes volver a intentarlo.':(e as Error).message);}
    finally{setBusy(false);}
  }
  function download(){
    const text=`VYRSEA · KIT DE RECUPERACIÓN\nhttps://vyrsea.com\nUsuario: ${username}\nGenerado: ${new Date().toISOString()}\n\n${codes.join('\n')}\n\nCada código sirve una sola vez para crear una nueva passkey desde Iniciar sesión → Recuperar acceso.\nLa recuperación revoca todas las passkeys y sesiones anteriores.\nGuarda este archivo fuera del dispositivo que utilizas para entrar. No compartas estos códigos.\nGenerar otro kit invalida todos los códigos de este.\n`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='vyrsea-kit-recuperacion.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="panel settings-panel security-panel" aria-labelledby="access-security-title">
    <div className="panel-heading"><div><h2 id="access-security-title"><ShieldCheck size={20}/>Seguridad de acceso</h2><p>Prepara una alternativa antes de perder tu dispositivo.</p></div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="security-message" role="status">{message}</p>}
    {!data&&!error&&<p className="muted">Consultando tus métodos de acceso…</p>}
    {data&&<div className="security-methods"><div><h3><Fingerprint size={18}/>Tus passkeys · {data.passkeys.length}/5</h3><ul className="security-key-list">{data.passkeys.map((key,i)=><li key={i}><strong>{key.label}</strong><span>{key.createdAt?new Date(key.createdAt*1000).toLocaleDateString('es-ES'):'Passkey inicial'}</span></li>)}</ul><p>Usa otro dispositivo o una llave física para tener un respaldo independiente.</p><label>Nombre de la nueva passkey<input maxLength={60} value={label} disabled={busy} onChange={e=>setLabel(e.target.value)} placeholder="Llave USB, móvil de respaldo…"/></label><button className="button secondary" disabled={busy||!label.trim()||data.passkeys.length>=5} onClick={()=>act('passkey')}><Fingerprint size={16}/>Añadir passkey</button></div>
      <div><h3><KeyRound size={18}/>Kit de recuperación</h3><p><strong>{data.recovery.remaining} códigos disponibles</strong>{data.recovery.generatedAt&&<> · generado el {new Date(data.recovery.generatedAt*1000).toLocaleDateString('es-ES')}</>}</p><p>Ocho códigos de un solo uso. Guárdalos en un lugar seguro, fuera del dispositivo de acceso.</p>{data.recovery.remaining>0&&<p className="security-caution">Crear otro kit invalida inmediatamente todos los códigos anteriores.</p>}<button className="button secondary" disabled={busy} onClick={()=>act('kit')}><KeyRound size={16}/>{data.recovery.remaining?'Sustituir kit de recuperación':'Crear kit de recuperación'}</button><small>Se te pedirá confirmar tu passkey. Los códigos se muestran una sola vez.</small></div></div>}
    {codes.length>0&&<div className="security-kit"><h3>Guarda tu kit ahora</h3><p>Quien tenga uno de estos códigos y tu usuario podrá recuperar tu cuenta.</p><ol>{codes.map(code=><li key={code}><code>{code}</code></li>)}</ol><div className="security-kit-actions"><button className="button primary" onClick={download}><Download size={16}/>Descargar kit</button><button className="button secondary" onClick={()=>setCodes([])}>Ya lo he guardado · Ocultar</button></div></div>}
    <p className="settings-note">Al recuperar con un código, registrarás una nueva passkey y se revocarán todas las claves y sesiones anteriores. La recuperación mantiene tus datos, plan y estado de aprobación. Si pierdes también el kit y tus otras passkeys, no podrás restablecer el acceso automáticamente.</p>
    {busy&&<p className="muted" role="status">Confirma la operación en tu dispositivo…</p>}
  </section>;
}
