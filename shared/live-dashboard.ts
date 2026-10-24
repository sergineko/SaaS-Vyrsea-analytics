import type {DashboardData,DashboardLive,HourStat} from '../src/types';
// Replace only the contribution of the current hour. Closed history remains in
// memory, including when several hours share a chart bucket for a long period.
export function mergeLiveDashboard(base:DashboardData,next:DashboardLive):DashboardData|null {
 if(!base.currentStats||base.liveHour!==next.liveHour||base.windowDays!==next.windowDays||base.workspace?.id!==next.workspace?.id||
  base.limits.id!==next.limits.id||base.limits.historyDays!==next.limits.historyDays||
  base.monitors.map(m=>m.id).sort().join(',')!==next.monitors.map(m=>m.id).sort().join(','))return null;
 const buckets=new Map(base.stats.map(s=>[s.monitorId+':'+s.hour,{...s}]));
 for(const [rows,sign] of [[base.currentStats,-1],[next.currentStats,1]] as const)for(const row of rows){
  const key=row.monitorId+':'+row.hour,previous=buckets.get(key)??{monitorId:row.monitorId,hour:row.hour,total:0,successful:0,totalMs:0};
  for(const field of ['total','successful','totalMs'] as const)previous[field]+=row[field]*sign;
  buckets.set(key,previous);
 }
 return {...base,...next,stats:[...buckets.values()].filter((s:HourStat)=>s.total>0).sort((a,b)=>a.hour-b.hour)};
}
