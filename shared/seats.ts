import type {PlanId} from './plans';

export const seatLimit=(plan:PlanId,unlimited=false)=>unlimited||plan==='business'?null:plan==='pro'?3:1;
export const seatTerms=(plan:PlanId)=>plan==='pro'?'1 usuario incluido · +10 €/mes por usuario adicional · máximo 3':plan==='business'?'1 usuario incluido · precio por usuario adicional acordado en el contrato':'1 usuario incluido';
export function seatPricing(plan:PlanId,users:number,baseCents:number|null=null,cycle:'monthly'|'yearly'='monthly',exempt=false,customSeatCents=1500){
  if(!Number.isSafeInteger(users)||users<1||baseCents!==null&&(!Number.isSafeInteger(baseCents)||baseCents<0))throw new Error('Invalid subscription quantities');
  if(!Number.isSafeInteger(customSeatCents)||customSeatCents<0)throw new Error('Invalid seat price');
  const months=cycle==='yearly'?12:1,included=1,unitCents=plan==='business'?customSeatCents:plan==='pro'?1000:0;
  const base=plan==='business'?baseCents:plan==='pro'?2999:plan==='starter'?799:0;
  const seatCents=exempt?0:Math.max(0,users-included)*unitCents*months;
  return {users,included,unitCents,seatCents,baseCents:exempt?0:base,totalCents:exempt?0:base===null?null:base+seatCents,cycle,exempt};
}
export type SeatPricing=ReturnType<typeof seatPricing>;
export interface SubscriptionSeats{plan:PlanId;users:number;pending:number;maximum:number|null;billing:SeatPricing}
export const euros=(cents:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(cents/100);
