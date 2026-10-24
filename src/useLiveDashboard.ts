import {useEffect,useRef} from 'react';
import type {DashboardLive} from './types';
type Options={enabled:boolean;scope:string;workspaceId:string;days:number;advanced:boolean;intervalSeconds:number;resetAt:number;
 onData:(data:DashboardLive)=>void;onChecked:(at:number)=>void;onScheduled:(at:number)=>void;onError:(message:string)=>void};

export function startDashboardFeed(options:Options,current=()=>options){
 if(!options.enabled)return()=>{};
 const period=Math.max(60,options.intervalSeconds)*1000;
 let disposed=false,attempting=false,leader=false,epoch=0,etag='',lastData:DashboardLive|null=null,failures=0,nextAt=options.resetAt+period;
 let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,release:(()=>void)|undefined;
 const key=`vyrsea-live-v2:${options.scope}:${options.days}:${Number(options.advanced)}:${options.intervalSeconds}`;
 let channel:BroadcastChannel|null=null;try{if(typeof BroadcastChannel!=='undefined')channel=new BroadcastChannel(key);}catch{/* Restricted browsers retain visible polling. */}
 let coordinated=Boolean(channel&&navigator.locks);
 const deliver=(data:DashboardLive|null,at:number)=>{if(disposed||document.hidden)return;if(data)current().onData(data);current().onChecked(at);};
 const publishSchedule=()=>{current().onScheduled(nextAt);channel?.postMessage({kind:'schedule',nextAt});};
 function schedule(delay:number){
  clearTimeout(timer);if(disposed||document.hidden||!leader)return;
  nextAt=Date.now()+Math.max(0,delay);publishSchedule();timer=setTimeout(()=>void poll(),Math.max(0,delay));
 }
 if(channel)channel.onmessage=event=>{
  if(disposed||document.hidden)return;const value=event.data;
  if(value?.kind==='need-schedule'&&leader){publishSchedule();return;}
  if(value?.kind==='schedule'&&Number.isFinite(value.nextAt)&&!leader){nextAt=value.nextAt;current().onScheduled(nextAt);return;}
  if(value?.kind==='snapshot'&&typeof value.at==='number'&&value.data?.workspace?.id===options.workspaceId){
   const changed=value.etag!==etag;etag=value.etag;deliver(changed?value.data:null,value.at);
  }
 };
 async function poll(){
  if(disposed||document.hidden||!leader||!navigator.onLine)return;
  const generation=epoch,active=new AbortController();controller=active;const timeout=setTimeout(()=>active.abort(),12000);
  try{
   const response=await fetch(`/api/dashboard/live?days=${options.days}${options.advanced?'&view=advanced':''}`,{credentials:'same-origin',cache:'no-store',signal:active.signal,
    headers:{'X-Vyrsea-Workspace':options.workspaceId,...(etag?{'If-None-Match':etag}:{})}});
   if(response.status!==304){
    const data=await response.json() as DashboardLive&{error?:string;code?:string};
    if(!response.ok){if(response.status===401||data.code==='ACCOUNT_PENDING'||data.code==='ACCOUNT_SUSPENDED')window.dispatchEvent(new Event('vyrsea:account-changed'));throw new Error(data.error??'No se ha podido actualizar el panel.');}
    lastData=data;etag=response.headers.get('ETag')??'';
   }
   if(disposed||document.hidden||generation!==epoch)return;
   const at=Number(response.headers.get('X-Vyrsea-Checked-At'))||Math.floor(Date.now()/1000);failures=0;
   deliver(response.status===304?null:lastData,at);channel?.postMessage({kind:'snapshot',data:lastData,etag,at});
  }catch(error){if(!disposed&&!document.hidden&&generation===epoch){failures++;current().onError((error as Error).name==='AbortError'?'La actualización está tardando. Se reintentará automáticamente.':(error as Error).message);}}
  finally{clearTimeout(timeout);if(controller===active)controller=undefined;}
  if(!disposed&&!document.hidden&&leader&&generation===epoch)schedule(period*Math.min(4,2**failures));
 }
 function startLeader(){leader=true;etag='';lastData=null;failures=0;schedule(Math.max(0,nextAt-Date.now()));}
 async function acquire(){
  if(disposed||document.hidden||attempting||leader||!navigator.onLine)return;attempting=true;
  if(!coordinated){attempting=false;startLeader();return;}
  try{await navigator.locks.request(key,{ifAvailable:true},async lock=>{
   if(!lock||disposed||document.hidden)return;
   const held=new Promise<void>(resolve=>{release=resolve;});startLeader();await held;leader=false;release=undefined;
  });}catch{if(!disposed&&!document.hidden){coordinated=false;startLeader();}}
  finally{attempting=false;if(!leader&&!disposed&&!document.hidden){channel?.postMessage({kind:'need-schedule'});timer=setTimeout(()=>void acquire(),10000);}}
 }
 function pause(){epoch++;clearTimeout(timer);controller?.abort();release?.();if(!coordinated)leader=false;}
 const visibility=()=>{if(document.hidden)pause();else void acquire();},offline=()=>pause(),online=()=>void acquire();
 document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',offline);window.addEventListener('online',online);void acquire();
 return()=>{disposed=true;pause();channel?.close();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
}
export function useLiveDashboard(options:Options){
 const current=useRef(options);current.current=options;
 useEffect(()=>startDashboardFeed(options,()=>current.current),[options.enabled,options.scope,options.workspaceId,options.days,options.advanced,options.intervalSeconds,options.resetAt]);
}
