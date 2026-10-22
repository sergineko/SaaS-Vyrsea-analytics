import { useEffect,useRef,useState,type FormEvent } from 'react';
import { startAuthentication,startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON,PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint,ShieldCheck } from 'lucide-react';
import { Modal } from './ui';
import { request } from './api';
type Mode = 'register' | 'login' | 'recover';
export function AuthModal({onClose,onSuccess,initial='register',invitation}:{onClose:()=>void;onSuccess:()=>void;initial?:'register'|'login';invitation?:{token:string;username:string}}) {
  const [mode,setMode]=useState<Mode>(initial),[username,setUsername]=useState(invitation?.username??''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[token,setToken]=useState('');
  const [config,setConfig]=useState<{turnstileSiteKey:string;registrationAvailable:boolean}|null>(null);
  const challenge=useRef<HTMLDivElement>(null);
  useEffect(()=>{request<NonNullable<typeof config>>('/config').then(setConfig).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    if(!config?.turnstileSiteKey||mode==='login')return;
    let disposed=false;let widget:string|undefined; const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>{if(!disposed&&challenge.current)widget=window.turnstile?.render(challenge.current,{sitekey:config.turnstileSiteKey,theme:'light',action:mode==='recover'?'recover':'register',callback:setToken,'expired-callback':()=>setToken('')});};
    script.onerror=()=>setError('No se pudo cargar la verificación. Recarga la página.');document.head.appendChild(script);
    return()=>{disposed=true;if(widget)window.turnstile?.remove(widget);script.remove();setToken('');};
  },[config,mode]);
  function switchMode(next:Mode){setMode(next);setError('');setCode('');setToken('');}
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
    if(!window.PublicKeyCredential)throw new Error('Tu navegador necesita soporte de passkeys. Utiliza un navegador actualizado y un gestor de credenciales.');
    if(mode==='login'){
      const options=await request<PublicKeyCredentialRequestOptionsJSON>('/auth/login/options','POST');
      await request('/auth/login/verify','POST',await startAuthentication({optionsJSON:options}));
    } else {
      const endpoint=mode==='recover'?'recovery':'register';
      const options=await request<PublicKeyCredentialCreationOptionsJSON>(`/auth/${endpoint}/options`,'POST',{username,turnstileToken:token,...(mode==='recover'?{code}:invitation?{invitationToken:invitation.token}:{})});
      await request(`/auth/${endpoint}/verify`,'POST',await startRegistration({optionsJSON:options}));
    }
    onSuccess();
  }catch(e){setError((e as Error).name==='NotAllowedError'?'Se ha cancelado la passkey. Puedes volver a intentarlo.':(e as Error).message);if(mode!=='login'&&config?.turnstileSiteKey){window.turnstile?.reset();setToken('');}}finally{setBusy(false);}}
  return <Modal title={mode==='register'?(invitation?'Activar tu cuenta Business':'Solicitar acceso a Vyrsea'):mode==='recover'?'Recuperar tu acceso':'Acceder a Vyrsea'} onClose={onClose}>
    <div className="auth-symbol"><Fingerprint size={30}/></div>
    <p className="muted">{mode==='register'&&invitation?'Tu cuenta Business está preparada. Guarda tu propia passkey para activar el acceso. La invitación solo puede utilizarse una vez y no solicita ningún pago.':mode==='register'?'Beta con aprobación manual. Guarda una passkey y envía tu solicitud. Tras la aprobación tendrás 1 dominio y 2 monitores gratuitos.':mode==='recover'?'Usa un código del kit que guardaste en Ajustes → Seguridad de acceso. Registrarás una nueva passkey y se cerrarán todas las sesiones y claves anteriores.':'Usa la passkey guardada en tu dispositivo o gestor de contraseñas.'}</p>
    <form onSubmit={submit}>
      {mode!=='login'&&<label>Nombre de usuario<input value={username} readOnly={Boolean(invitation&&mode==='register')} onChange={e=>setUsername(e.target.value)} disabled={busy} required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9_.\-]+" autoComplete="username" placeholder="tu-estudio"/><small>Entre 3 y 40 caracteres: minúsculas, números, puntos o guiones.</small></label>}
      {mode==='recover'&&<label>Código de recuperación<input value={code} onChange={e=>setCode(e.target.value)} disabled={busy} required maxLength={80} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="VYR-XXXX-XXXX-…"/><small>Cada código se puede utilizar una sola vez. Tu plan, datos y estado de aprobación se conservan.</small></label>}
      {mode!=='login'&&<div ref={challenge}/>}
      {config&&!config.registrationAvailable&&mode!=='login'&&<p className="form-error">La verificación de seguridad aún no está disponible.</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy||!config||(mode!=='login'&&(!config.registrationAvailable||Boolean(config.turnstileSiteKey&&!token)))}><Fingerprint size={17}/>{busy?'Esperando a tu dispositivo…':mode==='register'?(invitation?'Activar con mi passkey':'Solicitar acceso con passkey'):mode==='recover'?'Crear nueva passkey y recuperar':'Entrar con passkey'}</button>
    </form>
    <p className="auth-switch">{mode==='register'?'¿Ya tienes cuenta?':mode==='recover'?'¿Tienes una passkey disponible?':'¿Primera visita?'} <button className="text-button" disabled={busy} onClick={()=>switchMode(mode==='login'?'register':'login')}>{mode==='login'?'Crear cuenta':'Iniciar sesión'}</button></p>
    {mode==='login'&&<p className="auth-switch"><button className="text-button" disabled={busy} onClick={()=>switchMode('recover')}>He perdido mi passkey · Recuperar acceso</button></p>}
    <p className="privacy-note"><ShieldCheck size={15}/>{mode==='recover'?'Si no tienes otra passkey ni un código guardado, aún no hay recuperación automática por correo.':'Protege tu cuenta con una segunda passkey y guarda un kit de recuperación fuera de este dispositivo.'}</p>
  </Modal>;
}
declare global { interface Window { turnstile?:{render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void;reset:()=>void} } }
