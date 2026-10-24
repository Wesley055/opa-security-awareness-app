'use strict';
// OPA production SOS routing diagnostic (S7, 23 Oct 2026).
// READ-ONLY: one READ ONLY transaction, runtime role, no writes.
// METADATA ONLY: short IDs, states, times and counts. No names, emails,
// phone numbers, locations, message text or incident content are read or printed,
// so this does not bypass Temporary Access.
// Run inside the production container:  /usr/local/bin/node opa-sos-diagnose.cjs [hours] [accounts]
const WWW = '/home/site/wwwroot';
const VAULT = 'https://opa-kv-production.vault.azure.net';
const HOURS = Math.min(Math.max(Number(process.argv[2]) || 48, 1), 168);
const fail = (code) => { console.log('FAILED', code); process.exit(1); };
const s8 = (v) => (v ? String(v).slice(0, 8) : '-');
const t = (v) => (v ? new Date(v).toISOString().slice(0, 19) + 'Z' : '-');

async function runtimeUrl() {
  const base = process.env.DATABASE_URL || '';
  if (base.startsWith('postgres')) return base;
  const ep = process.env.IDENTITY_ENDPOINT, hdr = process.env.IDENTITY_HEADER;
  if (!ep || !hdr) fail('MANAGED_IDENTITY_UNAVAILABLE');
  const tok = await fetch(ep + '?resource=https://vault.azure.net&api-version=2019-08-01', { headers: { 'X-IDENTITY-HEADER': hdr } });
  if (!tok.ok) fail('IDENTITY_TOKEN_' + tok.status);
  const { access_token } = await tok.json();
  const r = await fetch(VAULT + '/secrets/opa-production-database-runtime-url?api-version=7.4', { headers: { Authorization: 'Bearer ' + access_token } });
  if (!r.ok) fail('KEY_VAULT_' + r.status);
  return (await r.json()).value;
}

(async () => {
  const { PrismaClient } = require(WWW + '/node_modules/@prisma/client');
  const db = new PrismaClient({ datasourceUrl: await runtimeUrl(), log: [] });
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const q = (sql, ...a) => tx.$queryRawUnsafe(sql, ...a);
      console.log('OPA SOS DIAGNOSTIC  window=' + HOURS + 'h  now=' + t(new Date()) + '  build=' + (process.env.OPA_BUILD_SHA || 'unknown'));

      console.log('\n== FACILITIES (active or with recent incidents) ==');
      for (const f of await q(`SELECT f.id, f.name, f.type::text AS type, f."isActive" AS active, f."operationalState"::text AS state
          FROM "Facility" f WHERE f."isActive" OR EXISTS (SELECT 1 FROM "Incident" i WHERE i."facilityId"=f.id AND i."createdAt" > now() - ($1 || ' hours')::interval)
          ORDER BY f."createdAt"`, String(HOURS)))
        console.log(`facility=${s8(f.id)} name="${f.name}" type=${f.type} active=${f.active} state=${f.state}`);

      console.log('\n== STAFF SEATS (no names) ==');
      for (const u of await q(`SELECT id, role::text AS role, "facilityId" AS fac, "isActive" AS active, "membershipState"::text AS ms, "accountStatus"::text AS st
          FROM "User" WHERE role::text IN ('FACILITY_OPERATOR','FACILITY_ADMIN') ORDER BY role, "createdAt"`))
        console.log(`staff=${s8(u.id)} role=${u.role} facility=${s8(u.fac)} active=${u.active} membership=${u.ms} account=${u.st}`);

      console.log('\n== INCIDENTS IN WINDOW ==');
      const incidents = await q(`SELECT i.id, i."createdAt" AS created, i."lastTriggeredAt" AS last, i."retriggerCount" AS rt, i.status::text AS status,
            i.trigger::text AS trig, i."facilityId" AS ifac, i."resolvedAt" AS resolved,
            u.id AS uid, u.role::text AS urole, u."facilityId" AS ufac, u."membershipState"::text AS ums, u."isActive" AS uactive
          FROM "Incident" i JOIN "User" u ON u.id = i."userId"
          WHERE i."createdAt" > now() - ($1 || ' hours')::interval OR i."lastTriggeredAt" > now() - ($1 || ' hours')::interval
          ORDER BY i."createdAt" DESC LIMIT 40`, String(HOURS));
      for (const i of incidents) {
        const notes = await q(`SELECT channel::text AS ch, status::text AS st, count(*)::int AS n FROM "IncidentNotification" WHERE "incidentId"=$1::uuid GROUP BY 1,2 ORDER BY 1,2`, i.id);
        const routed = i.ifac ? (i.ifac === i.ufac ? 'facility=user-facility' : 'FACILITY-MISMATCH') : 'NO-FACILITY';
        console.log(`incident=${s8(i.id)} created=${t(i.created)} last=${t(i.last)} retriggers=${i.rt} status=${i.status} trigger=${i.trig} resolved=${t(i.resolved)}`);
        console.log(`   incidentFacility=${s8(i.ifac)} user=${s8(i.uid)} role=${i.urole} userFacility=${s8(i.ufac)} membership=${i.ums} userActive=${i.uactive} -> ${routed}`);
        console.log(`   notifications: ${notes.length ? notes.map((n) => `${n.ch}/${n.st}=${n.n}`).join(' ') : 'none'}`);
      }
      if (!incidents.length) console.log('none');

      if (process.argv.includes('accounts')) {
        // Email DOMAIN only; names never printed. sameNameAs flags an account whose
        // first+last name equals a staff seat's, without revealing the name.
        console.log('\n== PRIVILEGED ACCOUNTS (email domain only) ==');
        for (const u of await q(`SELECT id, role::text AS role, split_part(email,'@',2) AS domain, "isActive" AS active, "facilityId" AS fac,
              "createdAt" AS created, "activatedAt" AS activated, "credentialVersion" AS cv, "invitedByUserId" AS inv
            FROM "User" WHERE role::text IN ('ADMIN','TECHNICAL_SUPPORT','ORGANIZATION_ADMIN','RESPONDER') ORDER BY role, "createdAt"`))
          console.log(`account=${s8(u.id)} role=${u.role} domain=${u.domain} active=${u.active} facility=${s8(u.fac)} created=${t(u.created)} activated=${t(u.activated)} credentialVersion=${u.cv} invitedBy=${s8(u.inv)}`);

        console.log('\n== AUDIT EVENTS ABOUT PRIVILEGED ACCOUNTS (latest 40) ==');
        for (const a of await q(`SELECT e."createdAt" AS at, e.action, e."actorUserId" AS actor, e."actorRole" AS ar, e."resourceId" AS res
            FROM "AdministrativeAuditEvent" e JOIN "User" u ON u.id = e."resourceId"
            WHERE u.role::text IN ('ADMIN','TECHNICAL_SUPPORT','ORGANIZATION_ADMIN') ORDER BY e."createdAt" DESC LIMIT 40`))
          console.log(`${t(a.at)} ${a.action} resource=${s8(a.res)} actor=${s8(a.actor)} actorRole=${a.ar}`);

        console.log('\n== RESIDENTS AND STAFF BY FACILITY (no names) ==');
        for (const u of await q(`SELECT u.id, u.role::text AS role, u."facilityId" AS fac, split_part(u.email,'@',2) AS domain, u."isActive" AS active,
              u."membershipState"::text AS ms, u."createdAt" AS created, u."invitedByUserId" AS inv,
              (SELECT s.id FROM "User" s WHERE s.id <> u.id AND s.role::text IN ('FACILITY_OPERATOR','FACILITY_ADMIN','ADMIN','TECHNICAL_SUPPORT')
                 AND lower(s."firstName") = lower(u."firstName") AND lower(s."lastName") = lower(u."lastName") LIMIT 1) AS same
            FROM "User" u WHERE u.role::text IN ('USER','FACILITY_OPERATOR','FACILITY_ADMIN') ORDER BY u."facilityId", u.role, u."createdAt"`))
          console.log(`user=${s8(u.id)} role=${u.role} facility=${s8(u.fac)} domain=${u.domain} active=${u.active} membership=${u.ms} created=${t(u.created)} invitedBy=${s8(u.inv)}${u.same ? ' SAME-NAME-AS=' + s8(u.same) : ''}`);
      }

      console.log('\n== OPEN OR ACKNOWLEDGED NOW (any age) ==');
      for (const o of await q(`SELECT i.id, i."createdAt" AS created, i.status::text AS status, i."facilityId" AS fac, i."userId" AS uid
          FROM "Incident" i WHERE i.status::text IN ('OPEN','ACKNOWLEDGED') ORDER BY i."createdAt" DESC LIMIT 20`))
        console.log(`incident=${s8(o.id)} created=${t(o.created)} status=${o.status} facility=${s8(o.fac)} user=${s8(o.uid)}`);
    });
    console.log('\nDIAGNOSTIC DONE (read-only)');
  } catch (e) {
    console.log('FAILED', e && e.code ? e.code : (e && e.name) || 'error');
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
