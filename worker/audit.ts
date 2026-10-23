import type {Database,DatabaseStatement} from './database';
// Append the audit row to the same transaction as a product change. Security
// counters and read-only requests never generate audit records.
export function auditedDatabase(base:Database,audit:()=>DatabaseStatement):Database{
  const original=new WeakMap<DatabaseStatement,{statement:DatabaseStatement;query:string}>();
  const tracked=/^\s*(?:INSERT(?:\s+OR\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:users|business_contracts|account_invitations|monitors|maintenance_windows|status_pages|status_announcements|status_updates|status_domains|alert_destinations)\b/i;
  function unwrap(statements:DatabaseStatement[]){return statements.map(s=>original.get(s)?.statement??s);}
  function needsAudit(statements:DatabaseStatement[]){return statements.some(s=>tracked.test(original.get(s)?.query??''));}
  async function run(statements:DatabaseStatement[],ids?:string[]){
    const changes=needsAudit(statements),batch=unwrap(statements);if(changes)batch.push(audit());
    const result=ids&&base.monitorBatch?await base.monitorBatch(batch,ids):await base.batch(batch);
    return changes?result.slice(0,-1):result;
  }
  function wrap(statement:DatabaseStatement,query:string):DatabaseStatement{
    const result:DatabaseStatement={bind:(...values)=>wrap(statement.bind(...values),query),
      all:async<T>()=>(await run([result]))[0] as import('./database').DatabaseResult<T>,
      run:async<T>()=>(await run([result]))[0] as import('./database').DatabaseResult<T>,
      first:async<T>(column?:string)=>{const rows=(await run([result]))[0].results;return (rows.length?(column?rows[0][column]:rows[0]):null) as T|null;}};
    original.set(result,{statement,query});return result;
  }
  return {prepare:query=>wrap(base.prepare(query),query),batch:run as Database['batch'],monitorBatch:run as NonNullable<Database['monitorBatch']>};
}
