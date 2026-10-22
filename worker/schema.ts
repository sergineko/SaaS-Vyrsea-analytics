import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), username: text('username').notNull().unique(), createdAt: integer('created_at').notNull(), planId: text('plan_id').notNull().default('free'),
  domainLimit: integer('domain_limit'), monitorLimit: integer('monitor_limit'), historyDaysLimit: integer('history_days_limit'),
  accountStatus: text('account_status', { enum: ['pending','active','suspended'] }).notNull().default('pending'),
  isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false), lastActiveAt: integer('last_active_at').notNull().default(0),
  statusChangedAt: integer('status_changed_at').notNull().default(0), suspensionReason: text('suspension_reason'),
  reviewRequestedAt: integer('review_requested_at'), monitoringSince: integer('monitoring_since').notNull().default(0),
});
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(), counter: integer('counter').notNull().default(0), transports: text('transports').notNull(),
  label: text('label').notNull().default('Passkey'), createdAt: integer('created_at').notNull().default(0),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), expiresAt: integer('expires_at').notNull(),
});
export const recentAuth = sqliteTable('recent_auth', {
  sessionHash: text('session_hash').primaryKey().references(() => sessions.tokenHash, {onDelete:'cascade'}),
  userId: text('user_id').notNull().references(() => users.id, {onDelete:'cascade'}), expiresAt: integer('expires_at').notNull(),
});
export const recoveryCodes = sqliteTable('recovery_codes', {
  codeHash: text('code_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id, {onDelete:'cascade'}),
  createdAt: integer('created_at').notNull(),
});
export const monitors = sqliteTable('monitors', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), url: text('url').notNull(), rootDomain: text('root_domain'), paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['pending', 'up', 'degraded', 'down'] }).notNull().default('pending'),
  failures: integer('failures').notNull().default(0), lastCheckedAt: integer('last_checked_at'),
  lastStatusCode: integer('last_status_code'), lastResponseMs: real('last_response_ms'), lastError: text('last_error'),
  nextCheckAt: integer('next_check_at').notNull(), lastSlot: integer('last_slot').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
export const maintenanceWindows = sqliteTable('maintenance_windows', {
  id: text('id').primaryKey(), monitorId: text('monitor_id').notNull().references(() => monitors.id, {onDelete:'cascade'}),
  startsAt: integer('starts_at').notNull(), endsAt: integer('ends_at').notNull(), reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(), cancelledAt: integer('cancelled_at'),
});
export const maintenanceJobs = sqliteTable('maintenance_jobs', {
  id:text('id').primaryKey(),runDay:text('run_day').notNull(),startedAt:integer('started_at').notNull(),
  updatedAt:integer('updated_at').notNull(),completedAt:integer('completed_at'),pending:integer('pending').notNull().default(1),
  deletedJson:text('deleted_json').notNull().default('{}'),leaseUntil:integer('lease_until').notNull().default(0),leaseToken:text('lease_token'),
});
