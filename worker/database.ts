import postgres from 'postgres';
import type { Env } from './env';

export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; rows_read: number; rows_written: number; duration: number };
}
export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}
export interface Database {
  prepare(query: string): DatabaseStatement;
  batch<T = Record<string, unknown>>(statements: DatabaseStatement[]): Promise<DatabaseResult<T>[]>;
}
export type DatabaseBindings = Omit<Env, 'DB'> & { DB?: Database };

const tables = new Set(['users', 'credentials', 'sessions', 'challenges', 'rate_limits', 'plan_limits', 'monitors',
  'checks', 'hourly_stats', 'incidents', 'notifications', 'check_jobs', 'maintenance_windows', 'recent_auth',
  'recovery_codes', 'maintenance_jobs', 'status_pages', 'business_contracts', 'account_invitations']);

// Lex the small SQL dialect shared with the legacy D1 implementation. Never
// replace placeholders, function names or identifiers inside strings/comments.
export function postgresQuery(query: string, schema = 'vyrsea') {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema');
  const tokens = query.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|[a-zA-Z_][a-zA-Z_0-9]*|\s+|./g) ?? [];
  let parameter = 0;
  const ignored = /^\s+$|^--|^\/\*/;
  const next = (start: number) => { let i = start + 1; while (i < tokens.length && ignored.test(tokens[i])) i++; return i; };
  const previous = (start: number) => { let i = start - 1; while (i >= 0 && ignored.test(tokens[i])) i--; return i; };
  const ignoreInsert = /^\s*INSERT\s+OR\s+IGNORE\b/i.test(query);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("'") || token.startsWith('"') || ignored.test(token)) continue;
    if (token === '?') { tokens[i] = `$${++parameter}`; continue; }
    if (/^rowid$/i.test(token)) { tokens[i] = 'ctid'; continue; }
    if (/^unixepoch$/i.test(token) && tokens[next(i)] === '(' && tokens[next(next(i))] === ')') {
      const end = next(next(i)); tokens[i] = 'floor(extract(epoch from current_timestamp))::bigint';
      for (let j = i + 1; j <= end; j++) tokens[j] = ''; continue;
    }
    if (/^json_each$/i.test(token)) { tokens[i] = 'jsonb_array_elements_text'; continue; }
    if (/^(MAX|MIN)$/i.test(token) && tokens[next(i)] === '(') {
      let depth = 0, scalar = false;
      for (let j = next(i); j < tokens.length; j++) {
        if (tokens[j] === '(') depth++;
        if (tokens[j] === ')' && --depth < 0) break;
        if (tokens[j] === ',' && depth === 1) scalar = true;
        // Closing a nested argument must not decrement depth twice.
        if (tokens[j] === ')' && depth === 0) break;
      }
      if (scalar) tokens[i] = /^max$/i.test(token) ? 'GREATEST' : 'LEAST';
      continue;
    }
    if (tables.has(token.toLowerCase()) && !/^AS$/i.test(tokens[previous(i)] ?? '')) { tokens[i] = `"${schema}".${token}`; continue; }
    if (/[a-z][A-Z]|[A-Z][a-z]/.test(token) && /^AS$/i.test(tokens[previous(i)] ?? '') && token !== token.toUpperCase()) tokens[i] = `"${token}"`;
  }
  // Bind the serialized JSON as text, so Postgres.js does not JSON-encode it
  // a second time when it discovers a jsonb parameter type.
  let sql = tokens.join('').replace(/jsonb_array_elements_text\((\$\d+)\)/g, 'jsonb_array_elements_text($1::text::jsonb)');
  if (ignoreInsert) {
    sql = sql.replace(/^(\s*INSERT)\s+OR\s+IGNORE\b/i, '$1');
    const returning = /\s+RETURNING\b/i.exec(sql);
    sql = returning ? `${sql.slice(0, returning.index)} ON CONFLICT DO NOTHING${sql.slice(returning.index)}` : `${sql.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
  }
  return sql;
}

function numeric(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) throw new Error('Database number out of range');
  return number;
}
export function postgresClient(connectionString: string, ca?: string, hyperdrive = false) {
  const local = ['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname);
  return postgres(connectionString, {
    max: 3, fetch_types: false, prepare: true, connect_timeout: 15, idle_timeout: 5,
    ...(!hyperdrive && !local ? {ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}} : {}),
    types: {
      int8: { to: 20, from: [20], serialize: String, parse: numeric },
      numeric: { to: 1700, from: [1700], serialize: String, parse: numeric },
    },
    onnotice: () => {},
  });
}
type Client = ReturnType<typeof postgresClient>;
type Transaction = postgres.TransactionSql;

class Statement implements DatabaseStatement {
  constructor(readonly database: PostgresDatabase, readonly query: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.database, this.query, values); }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const {results} = await this.all<Record<string, unknown>>();
    return (results.length ? column ? results[0][column] : results[0] : null) as T | null;
  }
  async all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> { return (await this.database.batch<T>([this]))[0]; }
  async run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> { return this.all<T>(); }
}

export class PostgresDatabase implements Database {
  constructor(readonly client: Client, readonly schema = 'vyrsea') {}
  prepare(query: string) { return new Statement(this, query); }
  async batch<T = Record<string, unknown>>(statements: DatabaseStatement[]): Promise<DatabaseResult<T>[]> {
    if (!statements.length) return [];
    const prepared = statements.map(statement => {
      if (!(statement instanceof Statement) || statement.database !== this) throw new Error('Statements belong to another database');
      return { sql: postgresQuery(statement.query, this.schema), values: statement.values };
    });
    const run = async (connection: Client | Transaction) => {
      const results: DatabaseResult<T>[] = [];
      for (const statement of prepared) {
        const started = Date.now();
        const rows = await connection.unsafe(statement.sql, statement.values as postgres.ParameterOrJSON<never>[], {prepare: true});
        results.push({results: Array.from(rows) as T[], success: true, meta: {
          changes: rows.command === 'SELECT' ? 0 : rows.count, rows_read: 0,
          rows_written: rows.command === 'SELECT' ? 0 : rows.count, duration: Date.now() - started,
        }});
      }
      return results;
    };
    if (prepared.every(statement => /^\s*SELECT\b/i.test(statement.sql))) return run(this.client);
    // D1 serialized all writes. PostgreSQL must retry the ENTIRE transaction,
    // including eligibility reads, to retain quotas and delivery idempotency.
    for (let attempt = 0; ; attempt++) {
      try { return await this.client.begin('isolation level serializable', transaction => run(transaction)) as DatabaseResult<T>[]; }
      catch (error) {
        const code = (error as {code?: string}).code;
        if (attempt >= 4 || !['40001', '40P01'].includes(code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }
}

export async function withDatabase<T>(bindings: DatabaseBindings, operation: (env: Env) => Promise<T>, context?: ExecutionContext): Promise<T> {
  if (bindings.DB instanceof PostgresDatabase) return operation(bindings as Env);
  const connectionString = bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL;
  if (!connectionString) {
    if (!bindings.DB || bindings.DATABASE_PROVIDER === 'supabase') throw new Error('Database connection unavailable');
    return operation(bindings as Env);
  }
  const client = postgresClient(connectionString, bindings.DATABASE_CA, Boolean(bindings.HYPERDRIVE));
  try { return await operation({...bindings, DB: new PostgresDatabase(client, bindings.DATABASE_SCHEMA ?? 'vyrsea')} as Env); }
  finally {
    const closing = client.end({timeout: 5});
    if (context) context.waitUntil(closing); else await closing;
  }
}
