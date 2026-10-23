import type {Env} from './env';
import {nowSeconds} from './env';
import {seatLimit,seatPricing,type SubscriptionSeats} from '../shared/seats';
import type {PlanId} from '../shared/plans';

export async function subscriptionSeats(env:Env,id:string):Promise<SubscriptionSeats>{
 const row=await env.DB.prepare(`SELECT u.plan_id AS plan,u.is_owner AS exempt,
   1+(SELECT COUNT(*) FROM team_members t WHERE t.workspace_id=u.id) AS users,
   (SELECT COUNT(*) FROM team_invitations i WHERE i.workspace_id=u.id AND i.claimed_at IS NULL AND i.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM team_members t WHERE t.workspace_id=i.workspace_id AND t.user_id=i.user_id)) AS pending,
   b.price_cents AS base,b.billing_cycle AS cycle,b.seat_price_cents AS seatPrice FROM users u LEFT JOIN business_contracts b ON b.user_id=u.id WHERE u.id=?`)
   .bind(nowSeconds(),id).first<{plan:PlanId;exempt:number;users:number;pending:number;base:number|null;seatPrice:number|null;cycle:'monthly'|'yearly'|null}>();
 if(!row)throw new Error('Missing workspace');
 return {plan:row.plan,users:row.users,pending:row.pending,maximum:seatLimit(row.plan,!!row.exempt),billing:seatPricing(row.plan,row.users,row.base,row.cycle??'monthly',!!row.exempt,row.seatPrice??1500)};
}
