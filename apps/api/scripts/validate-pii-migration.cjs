// Applies actual lineage SQL to a new, local, isolated database. Never uses production.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const dotenv = require('dotenv');
const api = path.resolve(__dirname, '..');
async function main() {
  const configured = dotenv.parse(fs.readFileSync(path.join(api, '.env.test.local'))).DATABASE_URL;
  const url = new URL(configured);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Unsafe test target');
  const database = 'opa_pii_upgrade_' + Date.now() + '_test';
  const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try { await admin.query('CREATE DATABASE "' + database + '"'); } finally { await admin.end(); }
  url.pathname = '/' + database;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    if ((await db.query('SELECT current_database() AS db')).rows[0].db !== database) throw new Error('Wrong database');
    const directory = path.join(api, 'prisma', 'migrations');
    const migrations = fs.readdirSync(directory).filter(n => fs.existsSync(path.join(directory,n,'migration.sql'))).sort();
    const pii = migrations.filter(n => /protected_identity_foundation|protected_recipient_snapshots|enrollment_resolution_audit/.test(n));
    if (pii.length !== 3) throw new Error('Expected exactly three PII migrations');
    const baseline = migrations.filter(n => !pii.includes(n));
    for (const name of baseline) await db.query(fs.readFileSync(path.join(directory,name,'migration.sql'),'utf8'));
    const user=randomUUID(), facility=randomUUID(), incident=randomUUID(), notification=randomUUID(), invitation=randomUUID(), timeline=randomUUID(), evidence=randomUUID();
    await db.query('INSERT INTO "Facility" (id,name,type,"updatedAt") VALUES ($1,$2,$3,now())',[facility,'Fixture organization','OTHER']);
    await db.query('INSERT INTO "User" (id,email,"phoneNumber","firstName","lastName","facilityId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())',[user,'migration@example.test','+14155552671','Migration','Fixture',facility]);
    await db.query('INSERT INTO "Incident" (id,"userId",trigger,latitude,longitude,"updatedAt") VALUES ($1,$2,$3,0,0,now())',[incident,user,'SOS_BUTTON']);
    await db.query('INSERT INTO "IncidentNotification" (id,"incidentId","contactName","contactType",recipient,channel,status,payload,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',[notification,incident,'Fixture contact','TRUSTED','+14155552671','SMS','QUEUED',JSON.stringify({version:1,recipient:'+14155552671',message:'fixture'})]);
    await db.query('INSERT INTO "AccountInvitationDelivery" (id,"userId","facilityId",channel,status,recipient,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())',[invitation,user,facility,'SMS','QUEUED','+14155552671']);
    await db.query('INSERT INTO "IncidentTimelineEvent" (id,"incidentId",sequence,type,payload,source,"occurredAt",hash) VALUES ($1,$2,1,$3,$4,$5,now(),$6)',[timeline,incident,'CREATED',JSON.stringify({fixture:true}),'TEST','fixture-provenance-hash']);
    await db.query('INSERT INTO "Evidence" (id,"incidentId",type,status,sha256,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())',[evidence,incident,'DOCUMENT','STORED','fixture-evidence-sha']);
    const tables=['User','Facility','Incident','IncidentNotification','AccountInvitationDelivery','IncidentTimelineEvent','Evidence'];
    const before={};
    for(const table of tables) before[table]=(await db.query('SELECT * FROM "'+table+'"')).rows;
    for(const name of pii) await db.query(fs.readFileSync(path.join(directory,name,'migration.sql'),'utf8'));
    for(const table of tables) {
      const after=(await db.query('SELECT * FROM "'+table+'"')).rows.map(row => { delete row.protectedSnapshotId; return row; });
      if(JSON.stringify(after)!==JSON.stringify(before[table])) throw new Error('Fixture changed');
    }
    const result={database,serverVersion:(await db.query('SHOW server_version')).rows[0].server_version,baselineMigrations:baseline.length,piiMigrations:pii,totalMigrations:migrations.length,fixtureTablesVerified:tables.length,fixtureRowsVerified:7,plaintextUnchanged:true,evidenceProvenanceUnchanged:true,success:true};
    fs.writeFileSync(path.join(api,'pii-migration-validation.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  } finally { await db.end(); }
}
main().catch(() => { console.error('Isolated PII migration validation failed. No connection strings or database values logged.'); process.exitCode=1; });
