import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './env';
import { nowSeconds } from './env';
import {monitorBatch} from './database';

export const maintenance = new Hono<AppEnv>();
const inputSchema = z.object({ startsAt: z.number().int().positive(), endsAt: z.number().int().positive(), reason: z.string().trim().min(1).max(140) }).strict();

maintenance.post('/monitors/:id/maintenance', async c => {
  const monitorId = c.req.param('id'), userId = c.get('user').id;
  const monitor = await c.env.DB.prepare('SELECT id FROM monitors WHERE id=? AND user_id=?').bind(monitorId,userId).first();
  if (!monitor) throw new HTTPException(404,{message:'No se ha encontrado el monitor.'});
  const input = inputSchema.parse(await c.req.json()), now = nowSeconds();
  if (input.startsAt < now-60 || input.startsAt > now+30*86400 || input.endsAt-input.startsAt < 300 || input.endsAt-input.startsAt > 86400 || input.endsAt <= now) {
    throw new HTTPException(400,{message:'Programa entre 5 minutos y 24 horas de mantenimiento, desde ahora hasta los próximos 30 días.'});
  }
  const id=crypto.randomUUID();
  await monitorBatch(c.env.DB,[
    c.env.DB.prepare('INSERT INTO maintenance_windows(id,monitor_id,starts_at,ends_at,reason,created_at) VALUES(?,?,?,?,?,?)').bind(id,monitorId,input.startsAt,input.endsAt,input.reason,now),
    c.env.DB.prepare(`UPDATE monitors SET next_check_at=MAX(next_check_at,?),
      failures=CASE WHEN status='down' THEN failures ELSE 0 END,status=CASE WHEN status='degraded' THEN 'pending' ELSE status END
      WHERE id=? AND paused=0 AND ?<=?`).bind(input.endsAt,monitorId,input.startsAt,now),
  ],[monitorId]);
  return c.json({id},201);
});

maintenance.post('/monitors/:id/maintenance/:windowId/cancel', async c => {
  const row=await c.env.DB.prepare(`SELECT w.id,w.starts_at AS startsAt,w.ends_at AS endsAt,w.cancelled_at AS cancelledAt
    FROM maintenance_windows w JOIN monitors m ON m.id=w.monitor_id WHERE w.id=? AND m.id=? AND m.user_id=?`)
    .bind(c.req.param('windowId'),c.req.param('id'),c.get('user').id).first<{id:string;startsAt:number;endsAt:number;cancelledAt:number|null}>();
  if(!row)throw new HTTPException(404,{message:'No se ha encontrado el mantenimiento.'});
  if(row.cancelledAt!==null)return c.json({ok:true});
  const now=nowSeconds();
  if(row.endsAt<=now)throw new HTTPException(400,{message:'Este mantenimiento ya ha terminado.'});
  await monitorBatch(c.env.DB,[
    c.env.DB.prepare('UPDATE maintenance_windows SET cancelled_at=? WHERE id=? AND cancelled_at IS NULL').bind(now,row.id),
    c.env.DB.prepare(`UPDATE monitors SET next_check_at=MIN(next_check_at,MAX(?,COALESCE(last_checked_at,?-p.interval_seconds)+p.interval_seconds))
      FROM plan_limits p,users u WHERE monitors.id=? AND monitors.user_id=u.id AND u.plan_id=p.id AND monitors.paused=0 AND ?<=?`)
      .bind(now,now,c.req.param('id'),row.startsAt,now),
  ],[c.req.param('id')]);
  return c.json({ok:true});
});
