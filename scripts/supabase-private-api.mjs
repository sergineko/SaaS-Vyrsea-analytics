import {migrationConnection} from './postgres-migrate.mjs';
// Official workaround for the disabled Data API's repeated missing-schema logs:
// https://supabase.com/kb/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist
// An EMPTY, unprivileged schema is used; never expose the application schema.
const sql=migrationConnection();
try{
  await sql.begin(async tx=>{
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS pgrst_no_exposed_schemas;
      REVOKE ALL ON SCHEMA pgrst_no_exposed_schemas FROM PUBLIC,anon,authenticated;
      ALTER ROLE authenticator SET pgrst.db_schemas='pgrst_no_exposed_schemas';
      NOTIFY pgrst;`);
    const [objects]=await tx`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='pgrst_no_exposed_schemas'`;
    if(objects.n!==0)throw new Error('El esquema de la API debe permanecer vacío.');
  });
  console.log(JSON.stringify({configured:true,exposedSchema:'pgrst_no_exposed_schemas',applicationSchemaExposed:false}));
}catch(e){console.error(JSON.stringify({event:'supabase_private_api_failed',code:e.code,message:e.message}));process.exitCode=1;}
finally{await sql.end({timeout:5});}
