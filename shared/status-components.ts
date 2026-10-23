export interface StatusComponent {id:string;name:string;monitorIds:string[]}
export const ANNOUNCEMENT_STATES={investigating:'Investigando',identified:'Identificado',monitoring:'En observación',resolved:'Resuelto'} as const;
export interface Announcement {id:string;title:string;severity:'minor'|'major'|'critical';state:keyof typeof ANNOUNCEMENT_STATES;componentIds:string[];published:boolean;createdAt:number;updatedAt:number;updates:{state:keyof typeof ANNOUNCEMENT_STATES;message:string;createdAt:number}[]}
export function validPNG(value:string,maxBytes=32768,maxSide=1024){
  if(value==='')return true;
  if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
  try{const raw=atob(value.slice(22));if(raw.length>maxBytes||raw.length<24)return false;
    if([...raw.slice(0,8)].map(c=>c.charCodeAt(0)).join(',')!=='137,80,78,71,13,10,26,10')return false;
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);return view.getUint32(16)>0&&view.getUint32(16)<=maxSide&&view.getUint32(20)>0&&view.getUint32(20)<=maxSide;
  }catch{return false;}
}
// A group is healthy only when all its selected monitors are healthy. Technical
// measurements remain separate from the editorial state of announcements.
export function componentState(states:string[]){
  for(const state of ['down','degraded','pending','maintenance','paused'])if(states.includes(state))return state;
  return states.length?'up':'pending';
}
