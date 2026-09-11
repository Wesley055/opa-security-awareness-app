/* Verifies legacy truth preservation against an EMPTY, loopback-only test DB.
 * Usage: DATABASE_URL=<dedicated empty *_test database> node scripts/verify-delivery-migration.cjs
 * Does not create/drop databases, disable constraints, or touch production. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('_test')) throw Error('Requires a loopback *_test database');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const existing = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'");
    assert.equal(existing.rows[0].count, 0, 'Refusing a nonempty database');
    const root = path.resolve(__dirname, '../prisma/migrations');
    const target = '20260910010000_delivery_confirmation';
    for (const migration of fs.readdirSync(root).sort()) {
      if (migration >= target || !fs.existsSync(path.join(root, migration, 'migration.sql'))) continue;
      await client.query(fs.readFileSync(path.join(root, migration, 'migration.sql'), 'utf8'));
    }
    const user = randomUUID(), facility = randomUUID(), incident = randomUUID(), notification = randomUUID(), invitation = randomUUID();
    await client.query(`INSERT INTO "User" (id,email,"phoneNumber","firstName","lastName","updatedAt") VALUES ($1,'legacy@example.test','legacy-test','Legacy','Fixture',now())`, [user]);
    await client.query(`INSERT INTO "Facility" (id,name,type,"updatedAt") VALUES ($1,'Legacy fixture','OTHER',now())`, [facility]);
    await client.query(`INSERT INTO "Incident" (id,"userId",trigger,"updatedAt") VALUES ($1,$2,'SOS_BUTTON',now())`, [incident,user]);
    await client.query(`INSERT INTO "IncidentNotification" (id,"incidentId","contactName","contactType",recipient,channel,status,"attemptCount","deliveredAt","updatedAt") VALUES ($1,$2,'Legacy','Test','legacy@example.test','EMAIL','DELIVERED',2,'2026-01-01',now())`, [notification,incident]);
    await client.query(`INSERT INTO "AccountInvitationDelivery" (id,"userId","facilityId",channel,status,recipient,"attemptCount","sentAt","updatedAt") VALUES ($1,$2,$3,'SMS','SENT','legacy-test',3,'2026-01-01',now())`, [invitation,user,facility]);
    await client.query(fs.readFileSync(path.join(root,target,'migration.sql'),'utf8'));
    const n = (await client.query('SELECT * FROM "IncidentNotification" WHERE id=$1',[notification])).rows[0];
    const i = (await client.query('SELECT * FROM "AccountInvitationDelivery" WHERE id=$1',[invitation])).rows[0];
    assert.equal(n.status,'DELIVERED'); assert.equal(n.attemptCount,2); assert.ok(n.deliveredAt);
    assert.equal(i.status,'SENT'); assert.equal(i.attemptCount,3); assert.ok(i.sentAt);
    for (const row of [n,i]) {
      assert.equal(row.deliveryStatus,'UNKNOWN'); assert.equal(row.confirmedDeliveredAt,null);
      assert.equal(row.providerAcceptedAt,null); assert.equal(row.firstAttemptAt,null);
    }
    assert.equal((await client.query('SELECT count(*)::int AS count FROM "DeliveryAttempt"')).rows[0].count,0);
    console.log('PASS: additive migration preserves both legacy outboxes and claims no unproven delivery/attempt history.');
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
