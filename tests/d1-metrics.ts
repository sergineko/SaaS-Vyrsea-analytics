// Test-only D1 instrumentation. First() uses all() to expose D1's metadata.
export function measureD1(database:D1Database) {
  const samples:{sql:string;writes:number;reads:number}[]=[],statements=new WeakMap<object,string>();
  const capture=<T>(sql:string,result:D1Result<T>)=>{samples.push({sql:sql.replace(/\s+/g,' ').slice(0,90),writes:result.meta.rows_written??0,reads:result.meta.rows_read??0});return result;};
  function wrap(statement:D1PreparedStatement,sql:string):D1PreparedStatement {
    const proxy=new Proxy(statement,{get(target,property){
      if(property==='bind')return (...values:unknown[])=>wrap(target.bind(...values),sql);
      if(property==='run'||property==='all')return async()=>capture(sql,await target[property]());
      if(property==='first')return async(column?:string)=>{const row=capture(sql,await target.all<Record<string,unknown>>()).results[0];return row?(column===undefined?row:row[column]):null;};
      if(property==='raw')return async()=>capture(sql,await target.all<Record<string,unknown>>()).results.map(row=>Object.values(row));
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    }});statements.set(proxy,sql);return proxy;
  }
  const DB=new Proxy(database,{get(target,property){
    if(property==='prepare')return (sql:string)=>wrap(target.prepare(sql),sql);
    if(property==='batch')return async(items:D1PreparedStatement[])=>{const results=await target.batch(items);results.forEach((result,index)=>capture(statements.get(items[index])??'batch',result));return results;};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  return {DB,report:()=>({samples,queries:samples.length,writes:samples.reduce((n,s)=>n+s.writes,0),reads:samples.reduce((n,s)=>n+s.reads,0)})};
}
