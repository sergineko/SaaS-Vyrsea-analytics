import type {Env} from './env';
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const encode=(b:Uint8Array)=>btoa(String.fromCharCode(...b));
export async function encryptSecret(env:Env,value:string){
  if(!env.ALERTS_ENCRYPTION_KEY)throw new Error('Alert encryption unavailable');
  const key=await crypto.subtle.importKey('raw',decode(env.ALERTS_ENCRYPTION_KEY),'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  return encode(iv)+'.'+encode(new Uint8Array(cipher));
}
export async function decryptSecret(env:Env,value:string){
  const [iv,data]=value.split('.'),key=await crypto.subtle.importKey('raw',decode(env.ALERTS_ENCRYPTION_KEY!),'AES-GCM',false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},key,decode(data)));
}
export async function signature(secret:string,message:string,base64=false){
  const key=await crypto.subtle.importKey('raw',base64?decode(secret.replace(/^whsec_/,'')):new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))));
}
export async function verifyProviderSignature(secret:string,id:string,time:string,signatures:string,body:string,now:number){
  if(!id||!/^\d+$/.test(time)||Math.abs(now-Number(time))>300)return false;
  try{
    const key=await crypto.subtle.importKey('raw',decode(secret.replace(/^whsec_/,'')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    for(const item of signatures.split(' '))if(item.startsWith('v1,')&&await crypto.subtle.verify('HMAC',key,decode(item.slice(3)),new TextEncoder().encode(`${id}.${time}.${body}`)))return true;
  }catch{/* Invalid signatures are rejected without exposing the secret. */}
  return false;
}
