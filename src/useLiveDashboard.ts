import {useEffect,useRef} from 'react';
import type {DashboardLive} from './types';
const PERIOD=20000;
type Options={enabled:boolean;scope:string;workspaceId:string;days:number;advanced:boolean;onData:(data:DashboardLive)=>void;onChecked:(at:number)=>void;onError:(message:string)=>void};
export function useLiveDashboard(options:Options){
 const callbacks=useRef(options);callbacks.current=options;
 useEffect(()=>{
  if(!options.enabled)return;
  let disposed=false,attempting=false,leader=false,epoch=0,etag='',lastData:DashboardLive|null=null,failures=0,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,release:(()=>void)|undefined;
  const key=`vyrsea-live-v1:${options.scope}:${options.days}:${Number(options.advanced)}`;
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(key):null;
  const deliver=(data:DashboardLive|null,at:number)=>{if(disposed||document.hidden)return;if(data)callbacks.current.onData(data);callbacks.current.onChecked(at);};
  if(channel)channel.onmessage=event=>{const value=event.data;if(value?.kind==='snapshot'&&typeof value.at==='number'&&value.data?.workspace?.id===options.workspaceId){const changed=value.etag!==etag;etag=value.etag;deliver(changed?value.data:null,value.at);}};
  async function poll(){
   if(disposed||document.hidden||!leader)return;
   const generation=epoch,active=new AbortController();controller=active;const timeout=setTimeout(()=>active.abort(),12000);
   try{
    const response=await fetch(`/api/dashboard/live?days=${options.days}${options.advanced?'&view=advanced':''}`,{credentials:'same-origin',cache:'no-store',signal:active.signal,
     headers:{'X-Vyrsea-Workspace':options.workspaceId,...(etag?{'If-None-Match':etag}:{})}});
    if(response.status!==304){
     const data=await response.json() as DashboardLive&{error?:string;code?:string};
     if(!response.ok){if(response.status===401||data.code==='ACCOUNT_PENDING'||data.code==='ACCOUNT_SUSPENDED')window.dispatchEvent(new Event('vyrsea:account-changed'));throw new Error(data.error??'No se ha podido actualizar el panel.');}
     lastData=data as DashboardLive;etag=response.headers.get('ETag')??'';
    }
    if(disposed||document.hidden||generation!==epoch)return;
    const at=Number(response.headers.get('X-Vyrsea-Checked-At'))||Math.floor(Date.now()/1000);failures=0;
    deliver(response.status===304?null:lastData,at);channel?.postMessage({kind:'snapshot',data:lastData,etag,at});
   }catch(error){if(!disposed&&!document.hidden&&generation===epoch){failures++;callbacks.current.onError((error as Error).name==='AbortError'?'La actualización está tardando. Se reintentará automáticamente.':(error as Error).message);}}
   finally{clearTimeout(timeout);if(controller===active)controller=undefined;}
   if(!disposed&&!document.hidden&&leader&&generation===epoch)timer=setTimeout(()=>void poll(),Math.min(120000,PERIOD*2**Math.min(failures,3)));
  }
  async function acquire(){
   if(disposed||document.hidden||attempting||leader||!navigator.onLine)return;
   attempting=true;
   if(!navigator.locks){leader=true;attempting=false;void poll();return;}
   try{await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||disposed||document.hidden)return;
    leader=true;etag='';lastData=null;failures=0;
    const held=new Promise<void>(resolve=>{release=resolve;});void poll();await held;leader=false;release=undefined;
   });}finally{attempting=false;if(!disposed&&!document.hidden)timer=setTimeout(()=>void acquire(),PERIOD);}
  }
  function pause(){epoch++;clearTimeout(timer);controller?.abort();release?.();if(!navigator.locks)leader=false;}
  const visibility=()=>{if(document.hidden)pause();else void acquire();};
  const offline=()=>pause(),online=()=>void acquire();
  document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',offline);window.addEventListener('online',online);void acquire();
  return()=>{disposed=true;pause();channel?.close();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
 },[options.enabled,options.scope,options.workspaceId,options.days,options.advanced]);
}
