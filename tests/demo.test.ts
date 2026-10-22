import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '../src/demo';
import { demoHref, demoModeFromSearch } from '../src/demo-mode';
import { workspaceTools } from '../src/agents';

afterEach(()=>vi.useRealTimers());
describe('Read-only plan previews',()=>{
  it('preserves the basic demo URL and handles advanced deep links',()=>{
    expect(demoModeFromSearch('')).toBeNull();
    for(const mode of ['free','pro','business'] as const)expect(demoModeFromSearch(demoHref(mode).slice(1))).toBe(mode);
    expect(demoModeFromSearch('?demo=unknown')).toBe('free');
  });
  it('keeps the existing Free sample at one domain and two monitors',()=>{
    const data=demoData();expect(data.monitors).toHaveLength(2);
    expect(new Set(data.monitors.map(m=>m.rootDomain)).size).toBe(1);
    expect(data.limits).toMatchObject({id:'free',domains:1,monitors:2,advancedDashboard:false});
  });
  it.each([['pro',6,24,20,100],['business',9,42,50,300]] as const)('uses uneven monitor allocations and explicit example quotas for %s', (mode,domains,monitors,maxDomains,maxMonitors)=>{
    const data=demoData(7,mode);
    expect(data.monitors).toHaveLength(monitors);
    expect(new Set(data.monitors.map(m=>m.rootDomain)).size).toBe(domains);
    expect(data.monitors.filter(m=>m.rootDomain==='atelier-norte.example')).toHaveLength(8);
    expect(data.limits).toMatchObject({domains:maxDomains,monitors:maxMonitors,advancedDashboard:true,intervalSeconds:60});
    expect(data.demoContext?.customQuotaExample).toBe(mode==='business');
    expect(data.monitors.every(m=>new URL(m.url).hostname.endsWith('.example'))).toBe(true);
    expect(data.activeProbeProviders).toEqual(['cloudflare']);expect(data.multiProbeActive).toBe(false);
  });
  it.each(['2026-10-22T12:00:00Z','2026-10-22T12:59:59Z'])('keeps hourly samples valid at %s',time=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(time));
    const data=demoData(1,'pro');
    expect(data.stats.every(s=>s.total>=0&&s.total<=60&&s.successful>=0&&s.successful<=s.total&&s.hour<=data.serverTime)).toBe(true);
    expect(data.stats.filter(s=>s.monitorId==='demo-3-0').some(s=>s.successful<s.total)).toBe(true);
    for(const window of data.maintenance.filter(w=>w.startsAt<=data.serverTime)) {
      const monitor=data.monitors.find(m=>m.id===window.monitorId)!;
      expect(monitor.lastCheckedAt).toBeLessThanOrEqual(window.startsAt);
    }
  });
  it('labels advanced data as simulated for agent tools without activating paid features',async()=>{
    const tool=workspaceTools(async()=>demoData(7,'business'),true)[0];
    const result=await tool.execute({}) as {demo:boolean;measurementKind:string;demoContext:{mode:string};multiProbeActive:boolean};
    expect(result).toMatchObject({demo:true,measurementKind:'simulated',demoContext:{mode:'business'},multiProbeActive:false});
    expect(tool.annotations.readOnlyHint).toBe(true);
  });
});
