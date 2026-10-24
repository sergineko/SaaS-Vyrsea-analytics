import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {HTTPException} from 'hono/http-exception';
import type {AppEnv} from './env';
import {nowSeconds} from './env';
import {digest,randomToken} from './security';
import {usernameSchema} from './auth';
import {subscriptionSeats} from './seats';
export const business=new Hono<AppEnv>();
const contractInput=z.object({company:z.string().trim().max(100),contactEmail:z.union([z.email().max(254),z.literal('')]),priceCents:z.number().int().min(0).max(100000000),seatPriceCents:z.number().int().min(0).max(100000000).default(1500),billingCycle:z.enum(['monthly','yearly']),notes:z.string().trim().max(1500)}).strict();
async function target(c:Context<AppEnv>,id:string){const row=await c.env.DB.prepare('SELECT id,is_owner,plan_id FROM users WHERE id=?').bind(id).first<{id:string;is_owner:number;plan_id:string}>();if(!row)throw new HTTPException(404,{message:'Cuenta no encontrada.'});if(row.plan_id!=='business')throw new HTTPException(409,{message:'Las condiciones personalizadas corresponden a una cuenta Business.'});return row;}
business.get('/accounts/:id/contract',async c=>{await target(c,c.req.param('id'));const row=await c.env.DB.prepare('SELECT company,contact_email AS contactEmail,price_cents AS priceCents,seat_price_cents AS seatPriceCents,billing_cycle AS billingCycle,notes,updated_at AS updatedAt FROM business_contracts WHERE user_id=?').bind(c.req.param('id')).first();return c.json({contract:row,subscription:await subscriptionSeats(c.env,c.req.param('id')),billingEnabled:false});});
business.put('/accounts/:id/contract',async c=>{const id=c.req.param('id');await target(c,id);const value=contractInput.parse(await c.req.json());await c.env.DB.prepare('INSERT INTO business_contracts(user_id,company,contact_email,price_cents,seat_price_cents,billing_cycle,notes,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET company=excluded.company,contact_email=excluded.contact_email,price_cents=excluded.price_cents,seat_price_cents=excluded.seat_price_cents,billing_cycle=excluded.billing_cycle,notes=excluded.notes,updated_at=excluded.updated_at').bind(id,value.company,value.contactEmail,value.priceCents,value.seatPriceCents,value.billingCycle,value.notes,nowSeconds()).run();return c.json({ok:true,billingEnabled:false});});
business.post('/business-accounts',async c=>{
  const input=z.object({username:usernameSchema,domainLimit:z.number().int().min(1).max(1000000),monitorLimit:z.number().int().min(1).max(1000000),historyDaysLimit:z.number().int().min(1).max(365),contract:contractInput}).strict().parse(await c.req.json());
  const id=crypto.randomUUID(),token=randomToken(),now=nowSeconds(),expiresAt=now+7*86400;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,status_changed_at,domain_limit,monitor_limit,history_days_limit,monitoring_since) VALUES(?,?,?,'business','active',0,?,?,?,?,?,?)").bind(id,input.username,now,now,now,input.domainLimit,input.monitorLimit,input.historyDaysLimit,(Math.floor(now/60)+1)*60),
    c.env.DB.prepare('INSERT INTO business_contracts(user_id,company,contact_email,price_cents,seat_price_cents,billing_cycle,notes,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,input.contract.company,input.contract.contactEmail,input.contract.priceCents,input.contract.seatPriceCents,input.contract.billingCycle,input.contract.notes,now),
    c.env.DB.prepare('INSERT INTO account_invitations(user_id,token_hash,expires_at) VALUES(?,?,?)').bind(id,await digest(token),expiresAt),
  ]);
  return c.json({id,invitationURL:`${c.env.APP_ORIGIN}/#business=${encodeURIComponent(token)}&usuario=${encodeURIComponent(input.username)}`,expiresAt,billingEnabled:false},201);
});
business.post('/accounts/:id/invitation',async c=>{
  const id=c.req.param('id'),account=await target(c,id);if(account.is_owner)throw new HTTPException(409,{message:'La cuenta propietaria no se activa mediante invitaciones.'});z.object({}).strict().parse(await c.req.json());
  if(await c.env.DB.prepare('SELECT id FROM credentials WHERE user_id=? LIMIT 1').bind(id).first())throw new HTTPException(409,{message:'La cuenta ya tiene una passkey. Utiliza la recuperación de acceso; no se puede reiniciar desde una invitación.'});
  const token=randomToken(),expiresAt=nowSeconds()+7*86400;
  const row=await c.env.DB.prepare('SELECT username FROM users WHERE id=?').bind(id).first<{username:string}>();
  await c.env.DB.prepare('INSERT INTO account_invitations(user_id,token_hash,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,claimed_at=NULL').bind(id,await digest(token),expiresAt).run();
  return c.json({invitationURL:`${c.env.APP_ORIGIN}/#business=${encodeURIComponent(token)}&usuario=${encodeURIComponent(row!.username)}`,expiresAt,billingEnabled:false});
});
