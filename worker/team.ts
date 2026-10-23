import {Hono,type Context} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv,User} from './env';
import {nowSeconds} from './env';
import {digest,randomToken} from './security';
import {accountPlan} from './plans';

export const roleSchema=z.enum(['admin','operator','reader']);
export function auditStatement(c:Context<AppEnv>,action:string,resource:string,database=c.env.DB){
  const actor=c.get('actor')??c.get('user');
  return database.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,actor_name,action,resource,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),c.get('user').id,actor.id,actor.username,action,resource.slice(0,160),nowSeconds());
}
export async function workspaceContext(c:Context<AppEnv>,actor:User){
  c.set('actor',actor);c.set('workspaceRole','owner');c.set('user',actor);
  const id=c.req.path==='/api/workspaces'?undefined:c.req.header('X-Vyrsea-Workspace');
  if(!id||id===actor.id)return;
  const row=await c.env.DB.prepare(`SELECT u.id,u.username,u.created_at AS createdAt,u.account_status AS accountStatus,
    u.plan_id AS planId,u.last_active_at AS lastActiveAt,t.role FROM team_members t JOIN users u ON u.id=t.workspace_id
    WHERE t.workspace_id=? AND t.user_id=? AND u.account_status='active' AND (u.plan_id='business' OR u.is_owner=1)`)
    .bind(id,actor.id).first<User&{role:'admin'|'operator'|'reader'}>();
  if(!row)throw new HTTPException(403,{message:'Ya no tienes acceso a este espacio Business.'});
  c.set('user',{...row,isOwner:false});c.set('workspaceRole',row.role);
  if(['GET','HEAD'].includes(c.req.method))return;
  if(row.role==='reader')throw new HTTPException(403,{message:'Tu rol de lector solo permite consultar.'});
  if(row.role==='operator'&&!(/^\/api\/monitors\/[^/]+(?:\/check|\/maintenance(?:\/[^/]+\/cancel)?)?$/.test(c.req.path)&&c.req.method!=='DELETE'
    || /^\/api\/status-pages\/[^/]+\/announcements(?:\/[^/]+\/updates)?$/.test(c.req.path))){
    throw new HTTPException(403,{message:'Esta acción necesita un administrador del espacio.'});
  }
}
export const team=new Hono<AppEnv>();
team.get('/workspaces',async c=>{
  const actor=c.get('actor')??c.get('user');
  const rows=await c.env.DB.prepare(`SELECT u.id,u.username,t.role FROM team_members t JOIN users u ON u.id=t.workspace_id
    WHERE t.user_id=? AND u.account_status='active' AND (u.plan_id='business' OR u.is_owner=1) ORDER BY u.username LIMIT 50`).bind(actor.id).all();
  return c.json({own:{id:actor.id,username:actor.username,role:'owner'},shared:rows.results,current:c.get('user').id,role:c.get('workspaceRole')});
});
team.post('/team/accept',async c=>{
  const actor=c.get('actor')??c.get('user'),{token}=z.object({token:z.string().min(30).max(100)}).strict().parse(await c.req.json()),now=nowSeconds();
  const row=await c.env.DB.prepare(`SELECT i.* FROM team_invitations i JOIN users u ON u.id=i.workspace_id
    WHERE i.token_hash=? AND i.user_id=? AND i.claimed_at IS NULL AND i.expires_at>? AND u.account_status='active' AND (u.plan_id='business' OR u.is_owner=1)`)
    .bind(await digest(token),actor.id,now).first<{id:string;workspace_id:string;role:string}>();
  if(!row)throw new HTTPException(409,{message:'La invitación ha caducado, ya se utilizó o pertenece a otro usuario.'});
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO team_members(workspace_id,user_id,role,created_at) SELECT workspace_id,user_id,role,? FROM team_invitations
      WHERE id=? AND claimed_at IS NULL AND expires_at>? ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role`).bind(now,row.id,now),
    c.env.DB.prepare('UPDATE team_invitations SET claimed_at=? WHERE id=? AND claimed_at IS NULL').bind(now,row.id),
    c.env.DB.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,actor_name,action,resource,created_at) SELECT ?,?,?,?,\'team.accept\',?,? WHERE EXISTS(SELECT 1 FROM team_invitations WHERE id=? AND claimed_at=?)')
      .bind(crypto.randomUUID(),row.workspace_id,actor.id,actor.username,actor.id,now,row.id,now),
  ]);
  if(!results[0].meta.changes)throw new HTTPException(409,{message:'La invitación ya se utilizó.'});
  return c.json({ok:true,workspaceId:row.workspace_id});
});
team.use('/team/*',async(c,next)=>{
  if((await accountPlan(c.env,c.get('user').id)).id!=='business')throw new HTTPException(403,{message:'El equipo requiere Business.'});
  if(!['owner','admin'].includes(c.get('workspaceRole')))throw new HTTPException(403,{message:'La administración del equipo requiere el rol administrador.'});
  await next();
});
team.get('/team/members',async c=>{
  const id=c.get('user').id;
  const [members,invitations,audit]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT t.user_id AS id,u.username,t.role,t.created_at AS createdAt FROM team_members t JOIN users u ON u.id=t.user_id WHERE t.workspace_id=? ORDER BY u.username LIMIT 50').bind(id),
    c.env.DB.prepare('SELECT i.id,u.username,i.role,i.expires_at AS expiresAt FROM team_invitations i JOIN users u ON u.id=i.user_id WHERE i.workspace_id=? AND i.claimed_at IS NULL AND i.expires_at>? LIMIT 50').bind(id,nowSeconds()),
    c.env.DB.prepare('SELECT actor_name AS actor,action,resource,created_at AS createdAt FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').bind(id),
  ]);
  return c.json({members:members.results,invitations:invitations.results,audit:audit.results,role:c.get('workspaceRole')});
});
team.post('/team/invitations',async c=>{
  const value=z.object({username:z.string().trim().min(3).max(60),role:roleSchema}).strict().parse(await c.req.json());
  const id=c.get('user').id,target=await c.env.DB.prepare("SELECT id FROM users WHERE username=? AND account_status='active'").bind(value.username.toLowerCase()).first<{id:string}>();
  if(!target||target.id===id)throw new HTTPException(400,{message:'Elige otra cuenta activa registrada en Vyrsea.'});
  const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM team_members WHERE workspace_id=?').bind(id).first<{n:number}>();
  if(count!.n>=50)throw new HTTPException(409,{message:'La beta admite 50 miembros por espacio.'});
  const token=randomToken(),expiresAt=nowSeconds()+7*86400;
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO team_invitations(id,workspace_id,user_id,role,token_hash,expires_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET token_hash=excluded.token_hash,role=excluded.role,expires_at=excluded.expires_at,claimed_at=NULL`)
    .bind(crypto.randomUUID(),id,target.id,value.role,await digest(token),expiresAt),auditStatement(c,'team.invite',target.id)]);
  return c.json({invitationURL:`${c.env.APP_ORIGIN}/#team=${encodeURIComponent(token)}`,expiresAt},201);
});
team.patch('/team/members/:id',async c=>{
  const {role}=z.object({role:roleSchema}).strict().parse(await c.req.json());
  const result=await c.env.DB.batch([c.env.DB.prepare('UPDATE team_members SET role=? WHERE workspace_id=? AND user_id=?').bind(role,c.get('user').id,c.req.param('id')),auditStatement(c,'team.role.'+role,c.req.param('id'))]);
  if(!result[0].meta.changes)throw new HTTPException(404,{message:'Miembro no encontrado.'});return c.json({ok:true});
});
team.delete('/team/members/:id',async c=>{
  const id=c.req.param('id');await c.env.DB.batch([c.env.DB.prepare('DELETE FROM team_members WHERE workspace_id=? AND user_id=?').bind(c.get('user').id,id),
    c.env.DB.prepare('DELETE FROM team_invitations WHERE workspace_id=? AND user_id=?').bind(c.get('user').id,id),auditStatement(c,'team.revoke',id)]);return c.json({ok:true});
});
