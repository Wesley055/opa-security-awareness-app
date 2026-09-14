"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const schema = fs.readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8");
const migration = fs.readFileSync(path.join(root, "apps/api/prisma/migrations/20260911010000_safewalk_delivery_lifecycle/migration.sql"), "utf8");
// Exact normalized FK contract confirmed by read-only staging catalogs on 2026-09-14.
// Live agreement is additionally checked by the protected read-only schema comparison.
const contracts = [
  {table:"DeliveryAttempt", column:"safeWalkNoticeId", target:"SafeWalkNotice", name:"DeliveryAttempt_safeWalkNoticeId_fkey"},
  {table:"DeliveryStatusEvent", column:"safeWalkNoticeId", target:"SafeWalkNotice", name:"DeliveryStatusEvent_safeWalkNoticeId_fkey"},
  {table:"JourneySession", column:"safeWalkEmergencyIncidentId", target:"Incident", name:"safewalk_emergency_incident_fkey"}
];
let sql;
test.before(() => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opa-model-contract-"));
  try {
    const file = path.join(temp, "schema.prisma");
    fs.writeFileSync(file, schema);
    const result = cp.spawnSync(process.execPath, [
      require.resolve("prisma/build/index.js"), "migrate", "diff", "--from-empty",
      "--to-schema-datamodel", file, "--script"
    ], {cwd:temp, env:{...process.env, DATABASE_URL:"postgresql://offline:offline@127.0.0.1:1/opa_staging", CHECKPOINT_DISABLE:"1"}, encoding:"utf8", timeout:60000});
    assert.equal(result.status, 0, "Offline Prisma SQL generation must succeed");
    sql = result.stdout;
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
});
for (const c of contracts) {
  test(c.table + " generated FK matches migration and reviewed live contract", () => {
    const expected = 'ALTER TABLE "'+c.table+'" ADD CONSTRAINT "'+c.name+'" FOREIGN KEY ("'+c.column+'") REFERENCES "'+c.target+'"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;';
    assert.ok(sql.includes(expected));
    assert.equal(sql.split('\n').filter(line => line.includes('ADD CONSTRAINT "'+c.name+'"')).length, 1);
    const statement = migration.split(";").find(line => line.includes('ALTER TABLE "'+c.table+'"') && line.includes('REFERENCES "'+c.target+'"(id)'));
    assert.ok(statement);
    assert.ok(statement.includes('"'+c.column+'"'));
    assert.ok(statement.includes("ON DELETE RESTRICT"));
    assert.ok(!statement.includes("ON UPDATE"), "Committed omitted action is NO ACTION");
    assert.ok(!/DEFERRABLE|NOT VALID/.test(statement));
    const model = schema.split("model "+c.table+" {")[1].split("\n}")[0];
    assert.ok(model.includes(c.column+" String? @db.Uuid"), "Nullable UUID scalar is preserved");
    assert.ok(model.includes(c.target+'? @relation('), "Optional relation must remain represented");
  });
}
test("emergency relation uses exact FK map and matching inverse", () => {
  assert.ok(schema.includes('map: "safewalk_emergency_incident_fkey"'));
  assert.equal(schema.split('@relation("SafeWalkEmergencyIncident"').length - 1, 2);
  assert.ok(schema.includes('safeWalkEmergencyJourneys JourneySession[] @relation("SafeWalkEmergencyIncident")'));
});
