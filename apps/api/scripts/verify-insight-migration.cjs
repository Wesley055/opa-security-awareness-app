/* Isolated PostgreSQL proof; never accepts a production/development database. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const dotenv = require('dotenv');
const api = path.resolve(__dirname, '..'), repo = path.resolve(api, '../..');
const base = '3ae25962fae46103408b0e0d180bcc8dca4a9069';
const url = new URL(dotenv.parse(fs.readFileSync(path.join(api, '.env.test.local'))).DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Isolated local _test database required.');
const baselineName = 'opa_evidence_baseline_' + randomUUID().replace(/-/g, '') + '_test';
const baselineUrl = new URL(url); baselineUrl.pathname = '/' + baselineName;
const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
const prismaCli = require.resolve('prisma/build/index.js');
const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + repo.replace(/\\/g,'/'), '-C', repo, ...args], { encoding: 'utf8' });
const baselineSchema = path.join(os.tmpdir(), 'opa-evidence-base-' + randomUUID() + '.prisma');
async function main() {
  const admin = new Client({ connectionString: adminUrl.href }); await admin.connect();
  try { await admin.query('CREATE DATABASE "' + baselineName + '"'); } finally { await admin.end(); }
  const baseline = new Client({ connectionString: baselineUrl.href }); await baseline.connect();
  try {
    const migrations = git('ls-tree', '-r', '--name-only', base, 'apps/api/prisma/migrations').trim().split(/\r?\n/).filter(p => p.endsWith('/migration.sql')).sort();
    for (const file of migrations) await baseline.query(git('show', base + ':' + file));
    fs.writeFileSync(baselineSchema, git('show', base + ':apps/api/prisma/schema.prisma'));
    const diff = (connection, schema) => execFileSync(process.execPath, [prismaCli, 'migrate', 'diff',
      '--from-url', connection, '--to-schema-datamodel', schema, '--script'], { cwd: api, encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url.href } }).replace(/\r\n/g, '\n');
    const oldDrift = diff(baselineUrl.href, baselineSchema);
    const newDrift = diff(url.href, path.join(api, 'prisma/schema.prisma'));
    console.log('BASE_MIGRATIONS_APPLIED=' + migrations.length);
    console.log('BASELINE_DATABASE=' + baselineName);
    console.log('BASELINE_AND_CANDIDATE_DRIFT_IDENTICAL=' + (oldDrift === newDrift));
    console.log(newDrift);
    if (oldDrift !== newDrift) throw new Error('Candidate introduces additional schema drift.');
    const candidate = new Client({ connectionString: url.href }); await candidate.connect();
    try {
      const tables = await candidate.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('ReportingProjection','AfterIncidentReport','CorrectiveAction') ORDER BY tablename");
      if (tables.rows.length !== 3) throw new Error('Reporting tables missing');
      const checks = await candidate.query("SELECT conname FROM pg_constraint WHERE conname IN ('air_positive_versions','corrective_positive_version','corrective_priority','corrective_completion','corrective_independent_verification')");
      if (checks.rows.length !== 5) throw new Error('Reporting checks missing');
      console.log('REPORTING_TABLES=3; REPORTING_CHECK_CONSTRAINTS=5');
    } finally { await candidate.end(); }
  } finally { await baseline.end(); if (fs.existsSync(baselineSchema)) fs.unlinkSync(baselineSchema); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
