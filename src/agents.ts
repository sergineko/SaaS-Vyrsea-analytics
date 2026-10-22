import { BILLING, PLAN_CATALOG } from '../shared/plans';
import type { DashboardData } from './types';
export interface AgentTool {
  name: string; description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; additionalProperties: false };
  annotations: { readOnlyHint: true; untrustedContentHint: boolean };
  execute: (input: unknown, options?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
}
const empty = { type: 'object' as const, properties: {}, additionalProperties: false as const };
export function publicTools(): AgentTool[] {
  return [{ name:'vyrsea_get_plans', description:'Consulta los límites y disponibilidad de los planes de Vyrsea. Solo Free está disponible. Starter, Pro / Agencia y Business todavía no se pueden contratar. Los pagos por Dodo Payments están deshabilitados.', inputSchema:empty, annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute:()=>({plans:PLAN_CATALOG,billing:BILLING,quotaPolicy:'Independent total maxima per account; Starter can use 15 monitors across 2 domains, with up to 5 domains.',demos:[{plan:'free',url:'/?demo'},{plan:'pro',url:'/?demo=pro'},{plan:'business',url:'/?demo=business'}].map(d=>({...d,simulated:true,readOnly:true})),activeProbeProviders:['cloudflare'],multiProbeActive:false,currentFeatures:['Free: HTTP cada 15 minutos e histórico de 7 días','1 dominio y 2 monitores gratis','Incidencias y alertas dentro del panel','Mantenimientos programados con reanudación automática','Histórico con filtro de errores'],unavailableFeatures:['Sondas de AWS y Google Cloud','Correos','Pagos','Caducidad SSL','Core Web Vitals de destinos']}) }];
}
export function workspaceTools(load: (signal?: AbortSignal) => Promise<DashboardData>, demo: boolean): AgentTool[] {
  return [{ name:'vyrsea_read_workspace', description:`Consulta dominios, monitores, incidencias y mantenimientos del espacio ${demo?'DE EJEMPLO; no son mediciones reales':'del usuario autenticado'}. Operación de lectura. No cambia monitores ni expone sesiones.`, inputSchema:empty, annotations:{readOnlyHint:true,untrustedContentHint:true},
    execute:async(_input,options)=>{options?.signal?.throwIfAborted();const data=await load(options?.signal);options?.signal?.throwIfAborted();return { demo, ...(demo?{demoContext:data.demoContext,measurementKind:'simulated'}:{measurementKind:'measured'}), measuredAt:data.serverTime, plan:data.limits,quotaPolicy:'Independent maximum totals per account; monitors can be distributed freely across the allowed domains.',activeProbeProviders:data.activeProbeProviders,multiProbeActive:data.multiProbeActive,
      domains:[...new Set(data.monitors.map(m=>m.rootDomain))],monitors:data.monitors.map(({id,name,url,rootDomain,paused,status,lastCheckedAt,lastStatusCode,lastResponseMs})=>({id,name,url,rootDomain,paused,status,lastCheckedAt,lastStatusCode,lastResponseMs})),maintenance:data.maintenance,incidents:data.incidents };} }];
}
type ModelContext = { registerTool: (tool: AgentTool, options:{ signal:AbortSignal }) => void | Promise<void> };
export function registerAgentTools(tools:AgentTool[], supplied?:ModelContext) {
  const controller=new AbortController();
  const context=supplied??(typeof document!=='undefined'?(document as Document & {modelContext?:ModelContext}).modelContext:undefined);
  if(context)for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:controller.signal})).catch(()=>{});}catch{}}
  return ()=>controller.abort();
}
