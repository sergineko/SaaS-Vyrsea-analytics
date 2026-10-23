import { lazy, Suspense, useEffect, useState } from 'react';
import { request } from './api';
import { Landing } from './Landing';
import { Logo } from './Brand';
import type { User } from './types';
import { publicTools, registerAgentTools } from './agents';
import { demoHref, demoModeFromSearch, type DemoMode } from './demo-mode';

const Dashboard = lazy(() => import('./Workspace').then(module => ({ default: module.Dashboard })));
const AuthModal = lazy(() => import('./AuthModal').then(module => ({ default: module.AuthModal })));
const AccountAccess = lazy(() => import('./AccountAccess').then(module => ({ default: module.AccountAccess })));
const InvitationConfirm=lazy(()=>import('./InvitationConfirm').then(module=>({default:module.InvitationConfirm})));
export default function App() {
  const [confirmation,setConfirmation]=useState(()=>{if(typeof location==='undefined')return null;const params=new URLSearchParams(location.hash.slice(1));for(const kind of ['team','confirm-email'] as const){const token=params.get(kind);if(token)return {kind,token};}return null;});
  const [user, setUser] = useState<User | null>(null);
  const [invitation,setInvitation]=useState(()=>{if(typeof location==='undefined')return undefined;const params=new URLSearchParams(location.hash.slice(1)),token=params.get('business'),username=params.get('usuario');return token&&username?{token,username}:undefined;});
  const [authMode, setAuthMode] = useState<'register' | 'login' | null>(()=>invitation?'register':null);
  useEffect(()=>{if(invitation||confirmation)history.replaceState({},'',location.pathname+location.search);},[]);
  const [demo, setDemo] = useState<DemoMode | null>(() => typeof location === 'undefined' ? null : demoModeFromSearch(location.search));
  async function loadUser() { setUser((await request<{ user: User | null }>('/me')).user); }
  useEffect(() => { loadUser().catch(() => {}); }, []);
  useEffect(() => { const changed = () => { loadUser().catch(() => {}); }; window.addEventListener('vyrsea:account-changed', changed); return () => window.removeEventListener('vyrsea:account-changed', changed); }, []);
  useEffect(() => registerAgentTools(publicTools()), []);
  useEffect(() => { const navigate = () => setDemo(demoModeFromSearch(location.search)); window.addEventListener('popstate', navigate); return () => window.removeEventListener('popstate', navigate); }, []);
  useEffect(() => { const robots=document.querySelector('meta[name="robots"]'); if(robots)robots.setAttribute('content',demo||user?'noindex,nofollow':'index,follow,max-image-preview:large'); }, [demo,user]);
  function leaveDemo() { setDemo(null); history.replaceState({}, '', '/'); }
  function showDemo(mode: DemoMode) { setDemo(mode); history.pushState({}, '', demoHref(mode)); window.scrollTo(0, 0); }
  async function exit() { if (!demo && user) { await request('/auth/logout', 'POST'); sessionStorage.removeItem('vyrsea-workspace');setUser(null); } leaveDemo(); }
  return <>
    {confirmation&&!authMode&&<Suspense fallback={null}><InvitationConfirm value={confirmation} user={Boolean(user)} onClose={()=>setConfirmation(null)} onLogin={()=>setAuthMode('login')}/></Suspense>}
    {user || demo ? <Suspense fallback={<div className="loading-screen"><Logo /><span>Abriendo tu espacio…</span></div>}>{!demo && user && user.accountStatus !== 'active' ? <AccountAccess user={user} onRefresh={loadUser} onExit={exit} /> : <Dashboard key={demo ?? 'account'} demo={demo !== null} demoMode={demo ?? 'free'} onDemoChange={showDemo} user={demo ? null : user} onExit={exit} onRegister={() => setAuthMode('register')} />}</Suspense> : <Landing onAuth={setAuthMode} onDemo={() => showDemo('free')} />}
    {authMode && <Suspense fallback={<div className="modal-backdrop"><div className="modal" role="status">Abriendo acceso seguro…</div></div>}><AuthModal invitation={invitation} initial={authMode} onClose={() => {setAuthMode(null);setInvitation(undefined);}} onSuccess={() => { setAuthMode(null);setInvitation(undefined); leaveDemo(); loadUser().catch(() => {}); }} /></Suspense>}
  </>;
}
