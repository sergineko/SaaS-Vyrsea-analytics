import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';

let mf: Miniflare, db: D1Database;
const insert = (owner: string, i: number, domain: string) => db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,1)').bind(`${owner}-${i}`,owner,`Service ${i}`,`https://s${i}.${domain}`,domain).run();

beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'quota-distribution-fixture'}});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) {
    const statements=readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/);
    await db.batch(statements.map(sql=>db.prepare(sql.trim())));
  }
});
afterAll(async()=>{await mf?.dispose();});

describe.sequential('Independent domain and total-monitor maxima',()=>{
  it('retains the real prototype global cap of ten monitors',async()=>{
    await db.prepare("INSERT INTO users(id,username,created_at,plan_id) VALUES('capacity','capacity',1,'starter')").run();
    for(let i=0;i<10;i++)await insert('capacity',i,i<8?'first.example':'second.example');
    await expect(insert('capacity',10,'second.example')).rejects.toThrow(/GLOBAL_CAPACITY/);
    expect((await db.prepare("SELECT COUNT(DISTINCT root_domain) AS n FROM monitors WHERE user_id='capacity'").first<{n:number}>())!.n).toBe(2);
    await db.prepare("DELETE FROM monitors WHERE user_id='capacity'").run();
  });

  it('allows all fifteen Starter monitors across only two domains, rejecting the sixteenth',async()=>{
    // Isolated in-memory capacity fixture only: paid-plan maxima exceed the current global trial cap.
    // Keep the actual production trigger otherwise intact; no migration or real data is modified.
    const original=(await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='monitor_capacity'").first<{sql:string}>())!.sql;
    expect(original).toContain("(SELECT COUNT(*) FROM monitors) >= 10");
    await db.batch([db.prepare('DROP TRIGGER monitor_capacity'),db.prepare(original.replace('(SELECT COUNT(*) FROM monitors) >= 10','(SELECT COUNT(*) FROM monitors) >= 100'))]);
    await db.prepare("INSERT INTO users(id,username,created_at,plan_id) VALUES('starter-two','starter-two',1,'starter')").run();
    for(let i=0;i<15;i++)await insert('starter-two',i,i<12?'first.example':'second.example');
    const usage=await db.prepare("SELECT COUNT(*) AS monitors,COUNT(DISTINCT root_domain) AS domains FROM monitors WHERE user_id='starter-two'").first();
    expect(usage).toEqual({monitors:15,domains:2});
    await expect(insert('starter-two',15,'second.example')).rejects.toThrow(/MONITOR_CAPACITY/);
  });

  it('rejects a sixth Starter domain while allowing more monitors on the existing five',async()=>{
    await db.prepare("INSERT INTO users(id,username,created_at,plan_id) VALUES('starter-five','starter-five',1,'starter')").run();
    for(let i=0;i<5;i++)await insert('starter-five',i,`client${i}.example`);
    await expect(insert('starter-five',5,'sixth.example')).rejects.toThrow(/DOMAIN_CAPACITY/);
    for(let i=5;i<15;i++)await insert('starter-five',i,'client0.example');
    expect((await db.prepare("SELECT COUNT(*) AS n FROM monitors WHERE user_id='starter-five'").first<{n:number}>())!.n).toBe(15);
  });
});
