import {useEffect,useRef} from 'react';
// Auxiliary directories change much less often than monitor states. Refresh
// only the mounted, visible view, and never stack background requests.
export function useVisibleRefresh(refresh:()=>Promise<unknown>,enabled=true,period=60000){
 const current=useRef(refresh);current.current=refresh;
 useEffect(()=>{
  if(!enabled)return;let disposed=false,running=false,timer:ReturnType<typeof setTimeout>;
  async function update(){if(disposed||document.hidden||!navigator.onLine||running)return;running=true;try{await current.current();}catch{/* Each screen retains its last successful data. */}finally{running=false;}}
  function schedule(){clearTimeout(timer);if(disposed||document.hidden)return;timer=setTimeout(async()=>{await update();schedule();},period);}
  const visible=()=>{clearTimeout(timer);if(!document.hidden){void update();schedule();}},online=()=>{void update();schedule();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',online);schedule();
  return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',online);};
 },[enabled,period]);
}
