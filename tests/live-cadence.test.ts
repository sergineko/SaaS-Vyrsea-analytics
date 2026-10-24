import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {startDashboardFeed} from '../src/useLiveDashboard';
import {countdownLabel} from '../src/RefreshCountdown';
let page:EventTarget&{hidden:boolean},browser:EventTarget,stop:(()=>void)|undefined;
const options=(seconds:number)=>({enabled:true,scope:'actor:workspace',workspaceId:'workspace',days:1,advanced:false,intervalSeconds:seconds,resetAt:Date.now(),onData:vi.fn(),onChecked:vi.fn(),onScheduled:vi.fn(),onError:vi.fn()});
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
 page=Object.assign(new EventTarget(),{hidden:false});browser=new EventTarget();
 vi.stubGlobal('document',page);vi.stubGlobal('window',browser);vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('BroadcastChannel',undefined);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:{id:'workspace'},monitors:[]},{headers:{ETag:'"first"','X-Vyrsea-Checked-At':String(Date.now()/1000)}})));
});
afterEach(()=>{stop?.();stop=undefined;vi.useRealTimers();vi.unstubAllGlobals();});
describe('Plan cadence without database work from the countdown',()=>{
 it.each([['Free',900],['Starter',300],['Pro / Business',60]] as const)('waits the full %s interval after the entry snapshot',async(_plan,seconds)=>{
  const config=options(seconds);stop=startDashboardFeed(config);
  expect(fetch).not.toHaveBeenCalled();expect(config.onScheduled).toHaveBeenLastCalledWith(Date.now()+seconds*1000);
  await vi.advanceTimersByTimeAsync(seconds*1000-1);expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(seconds*1000);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('stops while hidden and catches up once on return after the deadline',async()=>{
  stop=startDashboardFeed(options(60));await vi.advanceTimersByTimeAsync(15000);
  page.hidden=true;page.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(120000);expect(fetch).not.toHaveBeenCalled();
  page.hidden=false;page.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('does not shorten a slow-plan interval after network failures',async()=>{
  vi.mocked(fetch).mockRejectedValue(new Error('Offline'));const config=options(900);stop=startDashboardFeed(config);
  await vi.advanceTimersByTimeAsync(900000);expect(fetch).toHaveBeenCalledTimes(1);expect(config.onError).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1799999);expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('keeps conditional responses out of the data merge',async()=>{
  const config=options(60);stop=startDashboardFeed(config);await vi.advanceTimersByTimeAsync(60000);expect(config.onData).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValue(new Response(null,{status:304}));await vi.advanceTimersByTimeAsync(60000);
  expect(config.onData).toHaveBeenCalledTimes(1);expect(config.onChecked).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({'If-None-Match':'"first"'});
 });
 it('formats local countdown ticks without making any request',()=>{
  expect(countdownLabel(900000,0)).toBe('Próxima actualización en 15:00');expect(countdownLabel(300000,1000)).toBe('Próxima actualización en 4:59');expect(countdownLabel(60000,59000)).toBe('Próxima actualización en 0:01');expect(countdownLabel(60000,60000)).toBe('Actualizando…');expect(fetch).not.toHaveBeenCalled();
 });
});
