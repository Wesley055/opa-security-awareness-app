'use strict';
// OPA production database release runner. This release: schema 45 -> 46 (Duty Reports + staff profiles). v2: prepare (FacilityType owner) + resolve of the failed 20 Oct attempt.
// Pinned per release: SQL hashes, new migration hashes, schema hash and counts.
// Runs inside the production App Service container with /usr/local/bin/node.
// Modes, run separately and by hand: check | activate | migrate | cleanup | verify
// Credentials come from Key Vault through the app's managed identity, stay in
// memory and in child-process environments only, and are never printed.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const dns = require('node:dns').promises, { spawnSync } = require('node:child_process');

const HERE = __dirname;
const WWW = '/home/site/wwwroot';
const PRISMA_CLI = WWW + '/node_modules/prisma/build/index.js';
const HOST = 'opa-api-production-server.postgres.database.azure.com';
const PRIVATE_IP = '10.0.2.4';
const DB = 'opa-api-production-database';
const ADMIN = 'hhduhnfjoz', MIGRATOR = 'opa_production_migrations';
const OWNER = 'opa_production_release_owner', RUNTIME = 'opa_production_runtime';
const VAULT = 'https://opa-kv-production.vault.azure.net';
const SECRETS = { admin: 'opa-production-postgresql-admin-password', migrator: 'opa-production-database-migration-password' };
const SQL_HASH = {
  prepare: '61a0094897a82f62f4f020475f846ef37f310cd867a4e24eef42e1eb6959a5a6',
  activate: 'a88b43b93c4f75db182ee01b522758b324f9a32cb4cbdc4eed81de436674d566',
  // EstateFlow cleanup plus DutyShift, DutyReport, their enums and duty_report_immutable().
  cleanup: '8cdfc636adf273277395fdf26f16f401c5a305fac162382b3401cb1150a2a11c',
};
const NEW_MIGRATIONS = {
  '20261020010000_duty_reports_staff_profiles': '771ad63b53b0c04301ccb6717786bc01c74658a3823e5de29a03e9a82f966d72',
};
const SCHEMA_HASH = '64c7360372fbc313472ba6280a0f1b3c9e5ec715e428022f69d26f77d907dbf4';
const BEFORE = 45, AFTER = 46;
// The 20 Oct attempt failed on its first statement (must be owner of type FacilityType); nothing applied.
const FAILED = '20261020010000_duty_reports_staff_profiles';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const secretsSeen = [];
const scrub = s => secretsSeen.reduce((t, x) => (x ? t.split(x).join('***').split(encodeURIComponent(x)).join('***') : t), String(s));
const log = (k, v) => console.log(k.padEnd(28) + ' ' + (typeof v === 'string' ? v : JSON.stringify(v)));

async function secret(name) {
  const ep = process.env.IDENTITY_ENDPOINT, hdr = process.env.IDENTITY_HEADER;
  if (!ep || !hdr) fail('MANAGED_IDENTITY_UNAVAILABLE');
  const t = await fetch(ep + '?resource=https://vault.azure.net&api-version=2019-08-01', { headers: { 'X-IDENTITY-HEADER': hdr } });
  if (!t.ok) fail('IDENTITY_TOKEN_' + t.status);
  const { access_token } = await t.json();
  const r = await fetch(VAULT + '/secrets/' + name + '?api-version=7.4', { headers: { Authorization: 'Bearer ' + access_token } });
  if (!r.ok) fail('KEY_VAULT_' + r.status + '_' + name);
  const v = (await r.json()).value;
  if (!v) fail('KEY_VAULT_EMPTY_' + name);
  secretsSeen.push(v);
  return v;
}

// Same host, database and TLS parameters as the running API; only the login changes.
async function urlFor(who) {
  let base = process.env.DATABASE_URL || '';
  // In an SSH shell the setting may still be an unresolved Key Vault reference.
  if (!base.startsWith('postgres')) base = await secret('opa-production-database-runtime-url');
  let u; try { u = new URL(base); } catch { fail('RUNTIME_URL_UNPARSEABLE'); }
  if (u.hostname !== HOST || decodeURIComponent(u.pathname.slice(1)) !== DB) fail('RUNTIME_URL_TARGET');
  const addrs = await dns.lookup(HOST, { all: true });
  if (!addrs.length || !addrs.every(a => a.family === 4 && a.address === PRIVATE_IP)) fail('PRIVATE_TARGET');
  u.username = encodeURIComponent(who === 'admin' ? ADMIN : MIGRATOR);
  u.password = encodeURIComponent(await secret(SECRETS[who]));
  if (u.searchParams.get('sslmode') !== 'require' && u.searchParams.get('sslmode') !== 'verify-full') u.searchParams.set('sslmode', 'require');
  return u.toString();
}

async function client(who) {
  const { PrismaClient } = require(WWW + '/node_modules/@prisma/client');
  const c = new PrismaClient({ datasourceUrl: await urlFor(who), log: [] });
  const id = (await c.$queryRawUnsafe(
    "SELECT current_database() AS db, current_user AS role, host(inet_server_addr()) AS address, current_setting('server_version_num') AS version"))[0];
  if (id.db !== DB || id.role !== (who === 'admin' ? ADMIN : MIGRATOR) || id.address !== PRIVATE_IP || !String(id.version).startsWith('14')) fail('DATABASE_IDENTITY');
  return c;
}

const n = v => Number(v);
// Recovery is only allowed while none of migration 46's objects exist.
const untouched = s => !s.dutyTablesOwnedByReleaseOwner && !s.staffPhotoColumns && !s.sectorFacilityTypes && !s.dutyImmutableTrigger;
// Ledger is at 45 with, at most, the one known failed attempt pending recovery.
const ledgerOk = s => s.ledgerApplied === BEFORE && !s.otherIncomplete && s.ledgerIncomplete === s.failedAttempt;
async function state(c) {
  const q = async s => (await c.$queryRawUnsafe(s))[0];
  return {
    openIncidents: n((await q(`SELECT count(*) AS v FROM "Incident" WHERE status IN ('OPEN','ACKNOWLEDGED')`)).v),
    activeJourneys: n((await q(`SELECT count(*) AS v FROM "JourneySession" WHERE status IN ('STARTED','ACTIVE')`)).v),
    ledgerApplied: n((await q(`SELECT count(*) AS v FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).v),
    ledgerIncomplete: n((await q(`SELECT count(*) AS v FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`)).v),
    migratorSessions: n((await q(`SELECT count(*) AS v FROM pg_stat_activity WHERE usename='${MIGRATOR}'`)).v),
    migratorIsOwnerMember: (await q(`SELECT pg_has_role('${MIGRATOR}','${OWNER}','MEMBER') AS v`)).v,
    migratorCanCreateInPublic: (await q(`SELECT has_schema_privilege('${MIGRATOR}','public','CREATE') AS v`)).v,
    migratorCanWriteLedger: (await q(`SELECT has_table_privilege('${MIGRATOR}','public._prisma_migrations','INSERT') AS v`)).v,
    migratorOwnedObjects: n((await q(`SELECT (SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='${MIGRATOR}'))
      + (SELECT count(*) FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname='${MIGRATOR}'))
      + (SELECT count(*) FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='${MIGRATOR}')) AS v`)).v),
    runtimeUnreadableTables: n((await q(`SELECT count(*) AS v FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'
      AND NOT has_table_privilege('${RUNTIME}', c.oid, 'SELECT')`)).v),
    runtimeCanCreateInPublic: (await q(`SELECT has_schema_privilege('${RUNTIME}','public','CREATE') AS v`)).v,
    dutyTablesOwnedByReleaseOwner: n((await q(`SELECT count(*) AS v FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
      WHERE s.nspname='public' AND c.relname IN ('DutyShift','DutyReport') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='${OWNER}')`)).v),
    staffPhotoColumns: n((await q(`SELECT count(*) AS v FROM information_schema.columns WHERE table_schema='public' AND table_name='User'
      AND column_name IN ('photoKey','photoStatus','photoUpdatedAt','photoReviewedBy','photoReviewedAt')`)).v),
    sectorFacilityTypes: n((await q(`SELECT count(*) AS v FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='FacilityType'
      AND e.enumlabel IN ('ESTATE','SCHOOL','BANK','ORGANIZATION')`)).v),
    facilityTypeOwner: (await q(`SELECT typowner::regrole::text AS v FROM pg_type WHERE oid=to_regtype('public."FacilityType"')`)).v,
    failedAttempt: n((await q(`SELECT count(*) AS v FROM _prisma_migrations WHERE migration_name='${FAILED}' AND finished_at IS NULL AND rolled_back_at IS NULL`)).v),
    otherIncomplete: n((await q(`SELECT count(*) AS v FROM _prisma_migrations WHERE migration_name<>'${FAILED}' AND finished_at IS NULL AND rolled_back_at IS NULL`)).v),
    dutyImmutableTrigger: n((await q(`SELECT count(*) AS v FROM pg_trigger WHERE tgname='duty_report_immutable' AND NOT tgisinternal`)).v),
  };
}

function prisma(args, url, input) {
  const r = spawnSync('/usr/local/bin/node', [PRISMA_CLI, ...args], {
    cwd: HERE, input, encoding: 'utf8', timeout: 300000,
    env: { PATH: process.env.PATH, HOME: '/tmp', DATABASE_URL: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  console.log(scrub((r.stdout || '') + (r.stderr || '')).trim());
  return r.status === 0 && !r.error;
}

function reviewedSql(mode) {
  const bytes = fs.readFileSync(path.join(HERE, mode + '.sql'));
  if (sha(bytes) !== SQL_HASH[mode]) fail('SQL_HASH_' + mode);
  const text = bytes.toString('utf8'), prefix = '\\set ON_ERROR_STOP on\n';
  if (!text.startsWith(prefix) || /^\s*\\/m.test(text.slice(prefix.length))) fail('SQL_CLIENT_DIRECTIVE');
  return text.slice(prefix.length);
}

// Prisma schema directory for migrate deploy: the 42 migrations exactly as the
// running API ships them, plus the two new, hash-pinned migrations.
function stageMigrations() {
  const dir = path.join(HERE, 'deploy-prisma'), mig = path.join(dir, 'migrations');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(mig, { recursive: true });
  const live = WWW + '/apps/api/prisma/migrations';
  const old = fs.readdirSync(live).filter(d => fs.statSync(path.join(live, d)).isDirectory());
  if (old.length !== BEFORE) fail('LIVE_MIGRATION_COUNT_' + old.length);
  for (const d of old) fs.cpSync(path.join(live, d), path.join(mig, d), { recursive: true });
  fs.copyFileSync(path.join(live, 'migration_lock.toml'), path.join(mig, 'migration_lock.toml'));
  for (const [d, h] of Object.entries(NEW_MIGRATIONS)) {
    const f = path.join(HERE, 'prisma/migrations', d, 'migration.sql');
    if (sha(fs.readFileSync(f)) !== h) fail('NEW_MIGRATION_HASH_' + d);
    if (old.includes(d)) fail('NEW_MIGRATION_ALREADY_LIVE_' + d);
    fs.mkdirSync(path.join(mig, d)); fs.copyFileSync(f, path.join(mig, d, 'migration.sql'));
  }
  const schema = path.join(HERE, 'prisma/schema.prisma');
  if (sha(fs.readFileSync(schema)) !== SCHEMA_HASH) fail('SCHEMA_HASH');
  fs.copyFileSync(schema, path.join(dir, 'schema.prisma'));
  return path.join(dir, 'schema.prisma');
}

async function main() {
  const mode = process.argv[2];
  if (!['check', 'prepare', 'activate', 'resolve', 'migrate', 'cleanup', 'verify'].includes(mode)) fail('USAGE: check|prepare|activate|resolve|migrate|cleanup|verify');
  if (process.versions.node.split('.')[0] !== '22' || process.platform !== 'linux') fail('EXECUTION_CONTEXT');
  log('MODE', mode); log('UTC', new Date().toISOString()); log('API_BUILD', process.env.OPA_BUILD_SHA || 'unknown');

  if (mode === 'resolve') {
    const schema = stageMigrations();
    const admin = await client('admin'); const s = await state(admin); await admin.$disconnect();
    log('STATE', s);
    if (!s.migratorIsOwnerMember || !s.migratorCanWriteLedger) fail('NOT_ACTIVATED_RUN_ACTIVATE_FIRST');
    if (!ledgerOk(s) || !untouched(s)) fail('RESOLVE_PRECONDITION');
    if (!s.failedAttempt) { log('RESOLVE', 'nothing to resolve'); return; }
    const ok = prisma(['migrate', 'resolve', '--rolled-back', FAILED, '--schema', schema], await urlFor('migrator'));
    log('RESOLVE_EXIT', ok ? 0 : 1);
    if (!ok) { process.exitCode = 1; console.log('RESOLVE FAILED. Run cleanup now. Do not run migrate.'); }
    return;
  }

  if (mode === 'migrate') {
    const schema = stageMigrations();
    log('STAGED', `${BEFORE} live + ${Object.keys(NEW_MIGRATIONS).length} new migration(s), hashes verified`);
    const admin = await client('admin'); const s = await state(admin); await admin.$disconnect();
    if (!s.migratorIsOwnerMember || !s.migratorCanCreateInPublic) fail('NOT_ACTIVATED_RUN_ACTIVATE_FIRST');
    if (s.ledgerApplied !== BEFORE || s.ledgerIncomplete !== 0) fail('LEDGER_NOT_AT_' + BEFORE + '_RUN_RESOLVE_FIRST');
    if (s.facilityTypeOwner !== OWNER) fail('FACILITY_TYPE_OWNER_RUN_PREPARE_FIRST');
    const m = await client('migrator'); await m.$disconnect();
    log('MIGRATOR_LOGIN', 'verified');
    const ok = prisma(['migrate', 'deploy', '--schema', schema], await urlFor('migrator'));
    log('DEPLOY_EXIT', ok ? 0 : 1);
    console.log(ok ? 'NEXT: run cleanup now.' : 'MIGRATE FAILED. Run cleanup now anyway. Do not retry migrate.');
    if (!ok) process.exitCode = 1;
    return;
  }

  const admin = await client('admin');
  log('ADMIN_LOGIN', 'verified (private ' + PRIVATE_IP + ', PostgreSQL 14)');
  try {
    if (mode === 'prepare' || mode === 'activate' || mode === 'cleanup') {
      const sql = reviewedSql(mode);
      log('SQL_SHA256', SQL_HASH[mode]);
      if (mode === 'activate' || mode === 'prepare') {
        const s = await state(admin);
        if (s.openIncidents || s.activeJourneys) fail('EMERGENCY_IN_PROGRESS_' + s.openIncidents + '_' + s.activeJourneys);
        if (!ledgerOk(s) || !untouched(s)) fail('LEDGER_NOT_AT_' + BEFORE);
        if (mode === 'activate' && s.facilityTypeOwner !== OWNER) fail('FACILITY_TYPE_OWNER_RUN_PREPARE_FIRST');
      }
      await admin.$disconnect();
      // prisma db execute sends the reviewed script unchanged in one simple
      // query, as admin-step.cjs did: it stops at the first error, and the
      // script's own BEGIN/COMMIT blocks are kept. No enclosing transaction.
      fs.writeFileSync(path.join(HERE, 'exec.prisma'), 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n');
      const ok = prisma(['db', 'execute', '--schema', path.join(HERE, 'exec.prisma'), '--stdin'], await urlFor('admin'), sql);
      log('SQL_EXIT', ok ? 0 : 1);
      if (!ok) { process.exitCode = 1; console.log(mode === 'activate' ? 'ACTIVATE FAILED OR UNCERTAIN: run cleanup, do not retry activate.' : mode === 'prepare' ? 'PREPARE FAILED: send me this output; do not run anything else.' : 'CLEANUP FAILED: send me this output; do not run anything else.'); }
      const after = await client('admin'); log('STATE', await state(after)); await after.$disconnect();
      return;
    }
    const s = await state(admin);
    log('STATE', s);
    if (mode === 'check') {
      const ready = !s.openIncidents && !s.activeJourneys && ledgerOk(s) && untouched(s) && !s.migratorSessions
        && !s.migratorIsOwnerMember && !s.migratorCanCreateInPublic;
      log('READY', ready);
      log('NEXT', !ready ? 'stop: send this output' : s.facilityTypeOwner !== OWNER ? 'prepare' : 'activate');
    } else {
      const pass = s.ledgerApplied === AFTER && !s.ledgerIncomplete && !s.migratorSessions && !s.migratorIsOwnerMember
        && !s.migratorCanCreateInPublic && !s.migratorCanWriteLedger && !s.migratorOwnedObjects && !s.runtimeUnreadableTables
        && !s.runtimeCanCreateInPublic && s.dutyTablesOwnedByReleaseOwner === 2 && s.staffPhotoColumns === 5
        && s.sectorFacilityTypes === 4 && s.dutyImmutableTrigger === 1 && s.facilityTypeOwner === OWNER && !s.failedAttempt;
      log('VERIFY', pass ? 'PASS' : 'FAIL');
      if (!pass) process.exitCode = 1;
    }
  } finally { await admin.$disconnect().catch(() => {}); }
}

main().catch(e => { console.error('STOPPED: ' + scrub((e.code || '') + ' ' + e.message)); process.exitCode = 1; });
