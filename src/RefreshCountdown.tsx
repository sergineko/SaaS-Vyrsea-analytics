import {useEffect,useState} from 'react';
export function countdownLabel(nextAt:number,now:number){
 const remaining=Math.max(0,Math.ceil((nextAt-now)/1000));
 return remaining?`Próxima actualización en ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'Actualizando…';
}
export function RefreshCountdown({nextAt}:{nextAt:number}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>;
  function tick(){clearTimeout(timer);if(document.hidden)return;setNow(Date.now());timer=setTimeout(tick,1000);}
  document.addEventListener('visibilitychange',tick);tick();
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',tick);};
 },[nextAt]);
 return <span className="refresh-countdown" role="timer" aria-live="off" title="La frecuencia de actualización sigue el intervalo de tu plan. El contador funciona en tu navegador.">{countdownLabel(nextAt,now)}</span>;
}
