import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {migrationConnection,migratePostgres} from './postgres-migrate.mjs';

const tables=['plan_limits','users','credentials','sessions','challenges','rate_limits','monitors','checks','hourly_stats','incidents','notifications','check_jobs','maintenance_windows','recent_auth','recovery_codes','maintenance_jobs','status_pages','business_contracts','account_invitations'];
const source=process.argv[2],schema=process.argv[3]??'vyrsea';
if(!source||!/^vyrsea(?:_[a-z0-9_]+)?$/.test(schema))throw new Error('Uso: node scripts/import-d1-postgres.mjs copia-d1.sql [vyrsea]');
const sqlite=new DatabaseSync(':memory:');
// D1 exports tables in storage order; references may precede their tables.
// This in-memory staging copy cannot modify the source. PostgreSQL validates
// every FK again during the destination transaction below.
sqlite.exec('PRAGMA foreign_keys=OFF');
sqlite.exec(readFileSync(source,'utf8'));
if(sqlite.prepare('PRAGMA foreign_key_check').all().length)throw new Error('La copia D1 contiene referencias no válidas.');
const sql=migrationConnection();
const report={schema,startedAt:new Date().toISOString(),sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),tables:[]};
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const snapshot=(rows,columns)=>{
  const values=rows.map(row=>columns.map(column=>row[column.name]===null?null:/INT|REAL|DOUBLE|NUMERIC/i.test(column.type)?Number(row[column.name]):row[column.name]));
  values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
};
try{
  await migratePostgres(sql,schema);
  await sql.begin(async tx=>{
    for(const table of tables){
      const columns=sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
      if(!columns.length)throw new Error('Falta una tabla del origen: '+table);
      const rows=sqlite.prepare(`SELECT * FROM ${quote(table)}`).all();
      const target=quote(schema)+'.'+quote(table);
      const [existing]=await tx.unsafe(`SELECT count(*) AS n FROM ${target}`);
      if(table!=='plan_limits'&&Number(existing.n)!==0)throw new Error('El destino no está vacío: '+table);
      // Only the NEW database's application guard triggers are suspended during
      // the atomic copy. FKs and CHECK constraints continue to validate every row.
      await tx.unsafe(`ALTER TABLE ${target} DISABLE TRIGGER USER`);
      for(let offset=0;offset<rows.length;offset+=200){
        const chunk=rows.slice(offset,offset+200),parameters=[];
        const tuples=chunk.map(row=>'('+columns.map(column=>{parameters.push(row[column.name]);return '$'+parameters.length;}).join(',')+')');
        const upsert=table==='plan_limits'?' ON CONFLICT(id) DO UPDATE SET '+columns.filter(c=>c.name!=='id').map(c=>`${quote(c.name)}=excluded.${quote(c.name)}`).join(','):'';
        await tx.unsafe(`INSERT INTO ${target} (${columns.map(c=>quote(c.name)).join(',')}) VALUES ${tuples.join(',')}${upsert}`,parameters);
      }
      await tx.unsafe(`ALTER TABLE ${target} ENABLE TRIGGER USER`);
      const copied=await tx.unsafe(`SELECT * FROM ${target}`);
      const expected=snapshot(rows,columns),actual=snapshot(copied,columns);
      if(rows.length!==copied.length||expected!==actual)throw new Error('La verificación de contenido no coincide: '+table);
      report.tables.push({table,rows:rows.length,sha256:actual});
    }
  });
  report.completedAt=new Date().toISOString();report.verified=true;
  const output=source+'.postgres-verification.json';writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({verified:true,schema,tables:report.tables.length,rows:report.tables.reduce((n,t)=>n+t.rows,0),report:output}));
}catch(error){console.error(JSON.stringify({event:'import_failed',code:error.code,message:error.message}));process.exitCode=1;}
finally{sqlite.close();await sql.end({timeout:5});}
