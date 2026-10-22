import { useEffect,useRef,useState,type FormEvent } from 'react';
import { startAuthentication,startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON,PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint,ShieldCheck } from 'lucide-react';
import { Modal } from './ui';
import { request } from './api';
export function AuthModal({onClose,onSuccess,initial='register'}:{onClose:()=>void;onSuccess:()=>void;initial?:'register'|'login'}) {
  const [mode,setMode]=useState(initial),[username,setUsername]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[token,setToken]=useState('');
  const [config,setConfig]=useState<{turnstileSiteKey:string;registrationAvailable:boolean}|null>(null);
  const challenge=useRef<HTMLDivElement>(null);
  useEffect(()=>{request<NonNullable<typeof config>>('/config').then(setConfig).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    if(!config?.turnstileSiteKey||mode!=='register')return;
    let disposed=false;let widget:string|undefined; const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>{if(!disposed&&challenge.current)widget=window.turnstile?.render(challenge.current,{sitekey:config.turnstileSiteKey,theme:'light',action:'register',callback:setToken,'expired-callback':()=>setToken('')});};
    script.onerror=()=>setError('No se pudo cargar la verificación. Recarga la página.');document.head.appendChild(script);
    return()=>{disposed=true;if(widget)window.turnstile?.remove(widget);script.remove();setToken('');};
  },[config,mode]);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
    if(!window.PublicKeyCredential)throw new Error('Tu navegador necesita soporte de passkeys. Utiliza un navegador actualizado y un gestor de credenciales.');
    if(mode==='register'){const options=await request<PublicKeyCredentialCreationOptionsJSON>('/auth/register/options','POST',{username,turnstileToken:token});await request('/auth/register/verify','POST',await startRegistration({optionsJSON:options}));}
    else{const options=await request<PublicKeyCredentialRequestOptionsJSON>('/auth/login/options','POST');await request('/auth/login/verify','POST',await startAuthentication({optionsJSON:options}));}
    onSuccess();
  }catch(e){setError((e as Error).name==='NotAllowedError'?'Se ha cancelado la passkey. Puedes volver a intentarlo.':(e as Error).message);if(mode==='register'&&config?.turnstileSiteKey){window.turnstile?.reset();setToken('');}}finally{setBusy(false);}}
  return <Modal title={mode==='register'?'Solicitar acceso a Vyrsea':'Acceder a Vyrsea'} onClose={onClose}><div className="auth-symbol"><Fingerprint size={30}/></div><p className="muted">{mode==='register'?'Beta con aprobación manual. Guarda una passkey y envía tu solicitud. Tras la aprobación tendrás 1 dominio y 2 monitores gratuitos.':'Usa la passkey guardada en tu dispositivo o gestor de contraseñas.'}</p><form onSubmit={submit}>{mode==='register'&&<label>Nombre de usuario<input value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9_.\-]+" autoComplete="username webauthn" placeholder="tu-estudio"/><small>Entre 3 y 40 caracteres: minúsculas, números, puntos o guiones.</small></label>}{mode==='register'&&<div ref={challenge}/>} {config&&!config.registrationAvailable&&mode==='register'&&<p className="form-error">El administrador debe configurar Turnstile para abrir el registro.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||!config||(mode==='register'&&(!config.registrationAvailable||Boolean(config.turnstileSiteKey&&!token)))}><Fingerprint size={17}/>{busy?'Esperando a tu dispositivo…':mode==='register'?'Solicitar acceso con passkey':'Entrar con passkey'}</button></form><p className="auth-switch">{mode==='register'?'¿Ya tienes cuenta?':'¿Primera visita?'} <button className="text-button" onClick={()=>{setMode(mode==='register'?'login':'register');setError('');}}>{mode==='register'?'Iniciar sesión':'Crear cuenta'}</button></p><p className="privacy-note"><ShieldCheck size={15}/>Guarda la passkey en un gestor sincronizado. La recuperación por correo aún no está disponible.</p></Modal>;
}
declare global { interface Window { turnstile?:{render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void;reset:()=>void} } }
