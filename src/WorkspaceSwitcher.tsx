import {useEffect,useState} from 'react';
import {request} from './api';
type Data={own:{id:string;username:string};shared:{id:string;username:string;role:string}[];current:string;role:string};
export function WorkspaceSwitcher({onChange}:{onChange:()=>void}){
 const [data,setData]=useState<Data|null>(null);
 useEffect(()=>{let disposed=false;request<Data>('/workspaces').then(d=>{if(!disposed){const stored=sessionStorage.getItem('vyrsea-workspace');if(stored&&!d.shared.some(w=>w.id===stored)){sessionStorage.removeItem('vyrsea-workspace');onChange();}setData({...d,current:stored&&d.shared.some(w=>w.id===stored)?stored:d.own.id});}}).catch(()=>{});return()=>{disposed=true;};},[]);
 if(!data?.shared.length)return null;
 return <label className="workspace-switcher">Espacio activo<select aria-label="Cambiar de espacio" value={data.current} onChange={e=>{if(e.target.value===data.own.id)sessionStorage.removeItem('vyrsea-workspace');else sessionStorage.setItem('vyrsea-workspace',e.target.value);setData({...data,current:e.target.value});onChange();}}><option value={data.own.id}>Mi cuenta · {data.own.username}</option>{data.shared.map(w=><option key={w.id} value={w.id}>{w.username} · {w.role}</option>)}</select></label>;
}
