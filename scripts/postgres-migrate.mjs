import postgres from 'postgres';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function migrationConnection() {
  const pending='.wrangler/supabase-migration/connection.pending.json';
  const url=process.env.DATABASE_URL ?? (existsSync(pending)?JSON.parse(readFileSync(pending,'utf8')).adminUrl:undefined);
  if(!url)throw new Error('Configura DATABASE_URL en el entorno, nunca en el repositorio.');
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
  const caFile=process.env.DATABASE_CA_FILE ?? '.wrangler/supabase-migration/supabase-ca.crt';
  return postgres(url,{max:1,connect_timeout:20,prepare:true,onnotice:()=>{},...(!local?{ssl:{rejectUnauthorized:true,...(existsSync(caFile)?{ca:readFileSync(caFile,'utf8')}:{})}}:{})});
}

export async function migratePostgres(sql,schema='vyrsea') {
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Esquema no válido.');
  const files=readdirSync('migrations/postgres').filter(f=>f.endsWith('.sql')).sort();
  await sql.begin(async tx=>{
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"; REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC; CREATE TABLE IF NOT EXISTS "${schema}"._migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    for(const file of files){
      const source=readFileSync('migrations/postgres/'+file,'utf8'),checksum=createHash('sha256').update(source).digest('hex');
      const [applied]=await tx.unsafe(`SELECT checksum FROM "${schema}"._migrations WHERE name=$1`,[file]);
      if(applied){if(applied.checksum!==checksum)throw new Error('No modifiques una migración aplicada: '+file);continue;}
      await tx.unsafe(source.replace(/\bvyrsea\b/g,schema));
      await tx.unsafe(`INSERT INTO "${schema}"._migrations(name,checksum) VALUES($1,$2)`,[file,checksum]);
    }
  });
  return {schema,migrations:files.length};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const schema=process.argv.includes('--schema')?process.argv[process.argv.indexOf('--schema')+1]:'vyrsea';
  const sql=migrationConnection();
  try{console.log(JSON.stringify(await migratePostgres(sql,schema)));}
  catch(error){console.error(JSON.stringify({event:'postgres_migration_failed',code:error.code,message:error.message}));process.exitCode=1;}
  finally{await sql.end({timeout:5});}
}
