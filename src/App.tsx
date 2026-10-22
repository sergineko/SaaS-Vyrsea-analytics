import { lazy, Suspense, useEffect, useState } from 'react';
import { request } from './api';
import { Landing } from './Landing';
import { Logo } from './Brand';
import type { User } from './types';
import { publicTools, registerAgentTools } from './agents';
import { demoHref, demoModeFromSearch, type DemoMode } from './demo-mode';

const Dashboard = lazy(() => import('./Workspace').then(module => ({ default: module.Dashboard })));
const AuthModal = lazy(() => import('./AuthModal').then(module => ({ default: module.AuthModal })));
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login' | null>(null);
  const [demo, setDemo] = useState<DemoMode | null>(() => typeof location === 'undefined' ? null : demoModeFromSearch(location.search));
  async function loadUser() { setUser((await request<{ user: User | null }>('/me')).user); }
  useEffect(() => { loadUser().catch(() => {}); }, []);
  useEffect(() => registerAgentTools(publicTools()), []);
  useEffect(() => { const navigate = () => setDemo(demoModeFromSearch(location.search)); window.addEventListener('popstate', navigate); return () => window.removeEventListener('popstate', navigate); }, []);
  useEffect(() => { const robots=document.querySelector('meta[name="robots"]'); if(robots)robots.setAttribute('content',demo||user?'noindex,nofollow':'index,follow,max-image-preview:large'); }, [demo,user]);
  function leaveDemo() { setDemo(null); history.replaceState({}, '', '/'); }
  function showDemo(mode: DemoMode) { setDemo(mode); history.pushState({}, '', demoHref(mode)); window.scrollTo(0, 0); }
  return <>
    {user || demo ? <Suspense fallback={<div className="loading-screen"><Logo /><span>Abriendo tu espacio…</span></div>}><Dashboard key={demo ?? 'account'} demo={demo !== null} demoMode={demo ?? 'free'} onDemoChange={showDemo} user={demo ? null : user} onExit={async () => { if (!demo && user) { await request('/auth/logout', 'POST'); setUser(null); } leaveDemo(); }} onRegister={() => setAuthMode('register')} /></Suspense> : <Landing onAuth={setAuthMode} onDemo={() => showDemo('free')} />}
    {authMode && <Suspense fallback={<div className="modal-backdrop"><div className="modal" role="status">Abriendo acceso seguro…</div></div>}><AuthModal initial={authMode} onClose={() => setAuthMode(null)} onSuccess={() => { setAuthMode(null); leaveDemo(); loadUser().catch(() => {}); }} /></Suspense>}
  </>;
}
