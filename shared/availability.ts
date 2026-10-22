export interface AvailabilityStat {hour:number;total:number;successful:number;totalMs:number}
export function availabilityBuckets(stats:AvailabilityStat[],from:number,to:number,count=24){
  const width=(to-from)/count;
  const buckets=Array.from({length:count},(_,i)=>({from:from+i*width,to:from+(i+1)*width,total:0,successful:0,totalMs:0}));
  for(const stat of stats){const index=Math.floor((stat.hour-from)/width);if(index<0||index>=count)continue;const bucket=buckets[index];bucket.total+=stat.total;bucket.successful+=stat.successful;bucket.totalMs+=stat.totalMs;}
  return buckets;
}
export function availabilitySummary(stats:AvailabilityStat[]){
  const total=stats.reduce((n,s)=>n+s.total,0),successful=stats.reduce((n,s)=>n+s.successful,0);
  return {total,successful,uptime:total?100*successful/total:null,responseMs:total?stats.reduce((n,s)=>n+s.totalMs,0)/total:null};
}
