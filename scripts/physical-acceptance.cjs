// Infrastructure only: never runs application migrations or creates acceptance identities.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const ROOT = path.resolve(__dirname, "..");
const COMPOSE = path.join(ROOT, "ops/physical-acceptance/compose.yml");
const LOCAL = path.join(ROOT, ".local/physical-acceptance");
const ENV = path.join(LOCAL, "postgres.env");
const CONTAINER = "opa-physical-acceptance-persistent";
const VOLUME = "opa_delegation_physical_acceptance_pgdata";
const DB = "opa_delegation_acceptance";
const USER = "opa_acceptance";
const PORT = "55442";
const TARGET = "/var/lib/postgresql/data";
const BACKUPS = path.resolve(ROOT, "../OPA-physical-acceptance-backups");
class SafeFailure extends Error {}
function requireThat(ok, message) { if (!ok) throw new SafeFailure(message); }
function docker(args, input) {
  const r = cp.spawnSync("docker", args, {
    encoding: "utf8", input, timeout: 90000, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  requireThat(r.status === 0 && !r.error, "Docker operation failed; no credentials printed.");
  return r.stdout;
}
function compose(args) {
  requireThat(fs.existsSync(ENV), "Run init first. Local credential file missing.");
  return docker(["compose", "--env-file", ENV, "-f", COMPOSE, ...args]);
}
function validateConfig(c) {
  const s = c.services?.postgres;
  requireThat(s?.image === "postgres:16-alpine" && s.container_name === CONTAINER, "Unexpected physical container.");
  requireThat(!s.tmpfs?.length && !s.volumes_from?.length, "Physical PostgreSQL must not use tmpfs or inherited mounts.");
  requireThat(s.environment?.POSTGRES_DB === DB && s.environment?.POSTGRES_USER === USER, "Unexpected database identity.");
  requireThat(!s.environment?.PGDATA || s.environment.PGDATA === TARGET, "Unexpected PGDATA.");
  requireThat(s.volumes?.length === 1, "Exactly one persistent mount required.");
  const m = s.volumes[0];
  requireThat(m.type === "volume" && m.target === TARGET && m.source === "physical_pgdata" && !m.read_only, "Named writable data volume required.");
  requireThat(c.volumes?.physical_pgdata?.name === VOLUME, "Wrong physical volume.");
  const v=c.volumes.physical_pgdata;
  requireThat((!v.driver || v.driver === "local") && !Object.keys(v.driver_opts || {}).length, "Custom or tmpfs volume drivers forbidden.");
  requireThat(s.ports?.length === 1 && s.ports[0].host_ip === "127.0.0.1" &&
    String(s.ports[0].published) === PORT && Number(s.ports[0].target) === 5432, "Loopback-only physical port required.");
}
function validateRuntime(c) {
  requireThat(c.Name === "/" + CONTAINER && c.Config?.Image === "postgres:16-alpine", "Unexpected runtime container.");
  requireThat(c.Config?.Labels?.["opa.purpose"] === "physical-acceptance", "Physical label missing.");
  requireThat(Object.keys(c.HostConfig?.Tmpfs || {}).length === 0, "TMPFS FORBIDDEN for physical acceptance.");
  const env = Object.fromEntries((c.Config.Env || []).map(x => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
  requireThat(env.PGDATA === TARGET && env.POSTGRES_DB === DB && env.POSTGRES_USER === USER, "Unexpected runtime database identity.");
  requireThat(c.Mounts?.length === 1 && c.Mounts[0].Type === "volume" &&
    c.Mounts[0].Name === VOLUME && c.Mounts[0].Destination === TARGET && c.Mounts[0].RW === true, "Persistent physical mount mismatch.");
  const ports = c.HostConfig?.PortBindings?.["5432/tcp"];
  requireThat(ports?.length === 1 && ports[0].HostIp === "127.0.0.1" && ports[0].HostPort === PORT, "Physical runtime port mismatch.");
}
function validateVolume(v) {
  requireThat(v.Name === VOLUME && v.Driver === "local" && v.Scope === "local" && !Object.keys(v.Options || {}).length, "Persistent local volume driver required; custom/tmpfs options forbidden.");
}
function volumeCheck() { validateVolume(JSON.parse(docker(["volume","inspect",VOLUME]))[0]); }
function configCheck() { validateConfig(JSON.parse(compose(["config", "--format", "json"]))); }
function runtimeCheck() {
  configCheck();
  const c = JSON.parse(docker(["inspect", CONTAINER]))[0];
  validateRuntime(c);
  volumeCheck();
  return c;
}
function sql(statement) {
  return docker(["exec", "-i", CONTAINER, "psql", "-X", "-U", USER, "-d", DB, "-At", "-v", "ON_ERROR_STOP=1"], statement).trim();
}
function check() {
  const c = runtimeCheck();
  requireThat(c.State?.Running && c.State?.Health?.Status === "healthy", "Physical database is not healthy.");
  requireThat(sql("BEGIN READ ONLY; SELECT current_database(); COMMIT;").split("\n").includes(DB), "Database identity mismatch.");
  console.log(JSON.stringify({host:"127.0.0.1", port:PORT, database:DB, container:CONTAINER, volume:VOLUME, persistence:"verified configuration"}));
}
function verifyMigrations() {
  const expected = fs.readdirSync(path.join(ROOT, "apps/api/prisma/migrations"), {withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  const actual = sql('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;').split("\n");
  requireThat(JSON.stringify(actual) === JSON.stringify(expected), "Clean acceptance migrations require separate authorization and completion.");
  requireThat(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;') === "0", "Unfinished migration exists.");
}
function sentinel(create = false) {
  check();
  const receipt = path.join(LOCAL, "sentinel.json");
  if (create) {
    requireThat(!fs.existsSync(receipt), "Sentinel receipt already exists; use sentinel-check.");
    verifyMigrations();
    const token = crypto.randomUUID();
    fs.writeFileSync(receipt, JSON.stringify({token, database:DB, volume:VOLUME, createdAt:new Date().toISOString()}, null, 2), {flag:"wx"});
    // Keep the original receipt if SQL fails. Never silently replace continuity evidence.
    sql("BEGIN; CREATE SCHEMA acceptance_persistence; REVOKE ALL ON SCHEMA acceptance_persistence FROM PUBLIC; " +
      "CREATE TABLE acceptance_persistence.sentinel (id integer PRIMARY KEY CHECK (id=1), marker uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()); " +
      "INSERT INTO acceptance_persistence.sentinel(id,marker) VALUES (1,'" + token + "'); COMMIT;");
  }
  const saved = JSON.parse(fs.readFileSync(receipt, "utf8"));
  requireThat(saved.database === DB && saved.volume === VOLUME && /^[0-9a-f-]{36}$/.test(saved.token), "Invalid sentinel receipt.");
  requireThat(sql("SELECT marker::text FROM acceptance_persistence.sentinel WHERE id=1;") === saved.token, "SENTINEL MISMATCH. Stop; do not recreate it.");
  console.log("Persistence sentinel matches the original host receipt.");
}
async function verifyBackup(file) {
  check();
  requireThat(path.dirname(path.resolve(file)) === BACKUPS, "Backup must be in the dedicated host backup directory.");
  const meta = JSON.parse(fs.readFileSync(file+".json","utf8"));
  requireThat(meta.database === DB && meta.volume === VOLUME && meta.file === path.basename(file), "Backup target mismatch.");
  requireThat(fs.statSync(file).size === meta.bytes && meta.bytes > 5, "Backup size mismatch.");
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  requireThat(hash.digest("hex") === meta.sha256, "Backup hash mismatch.");
  const child = cp.spawn("docker", ["exec","-i",CONTAINER,"pg_restore","--list"], {stdio:["pipe","ignore","ignore"],windowsHide:true});
  const finished = new Promise((resolve,reject)=>{
    child.once("error",reject);
    child.once("close",code=>code===0?resolve():reject(Error("Backup catalog validation failed.")));
  });
  const timer=setTimeout(()=>child.kill(),120000);
  try { await Promise.all([pipeline(fs.createReadStream(file),child.stdin),finished]); } finally { clearTimeout(timer); }
  console.log("Backup size, SHA-256 and PostgreSQL archive catalog PASS. Isolated restore still required.");
}
async function backup() {
  check();
  fs.mkdirSync(BACKUPS, {recursive:true});
  const filename = "opa-physical-" + new Date().toISOString().replace(/[:.]/g,"-") + "-" + crypto.randomUUID() + ".dump";
  const dest = path.join(BACKUPS, filename);
  const output = fs.createWriteStream(dest, {flags:"wx"});
  const child = cp.spawn("docker", ["exec", CONTAINER, "pg_dump", "-U", USER, "-d", DB, "--format=custom", "--no-owner", "--no-acl"], {stdio:["ignore","pipe","ignore"], windowsHide:true});
  const finished = new Promise((resolve,reject) => {
    child.once("error",reject);
    child.once("close", code => code === 0 ? resolve() : reject(Error("pg_dump failed; partial artifact is NOT a backup.")));
  });
  const timer = setTimeout(()=>child.kill(), 120000);
  try { await Promise.all([pipeline(child.stdout, output), finished]); } finally { clearTimeout(timer); }
  requireThat(fs.statSync(dest).size > 5, "Backup is empty.");
  const fd = fs.openSync(dest,"r"), header=Buffer.alloc(5);
  try { fs.readSync(fd,header,0,5,0); } finally { fs.closeSync(fd); }
  requireThat(header.toString() === "PGDMP", "Backup format invalid.");
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(dest)) hash.update(chunk);
  const metadata = {file:filename,bytes:fs.statSync(dest).size,sha256:hash.digest("hex"),createdAt:new Date().toISOString(),host:"127.0.0.1",port:PORT,database:DB,container:CONTAINER,volume:VOLUME,format:"pg_dump custom"};
  fs.writeFileSync(dest+".json",JSON.stringify(metadata,null,2),{flag:"wx"});
  await verifyBackup(dest);
  console.log(JSON.stringify({backup:dest,...metadata}));
}
async function main(action) {
  if (action === "init") {
    fs.mkdirSync(LOCAL,{recursive:true});
    fs.writeFileSync(ENV, "OPA_PHYSICAL_POSTGRES_PASSWORD="+crypto.randomBytes(32).toString("hex")+"\n", {flag:"wx",mode:0o600});
    console.log("Created local credential. Protect this directory with your Windows user ACL; do not print or commit it.");
  } else if (action === "validate") {
    configCheck(); console.log("Physical Compose configuration PASS.");
  } else if (action === "start") {
    configCheck();
    const existing = docker(["ps","-a","--filter","name=^/"+CONTAINER+"$","--format","{{.Names}}"]).trim();
    if (existing) runtimeCheck();
    const volumes=docker(["volume","ls","--format","{{.Name}}"]).trim().split("\n");
    if (volumes.includes(VOLUME)) volumeCheck();
    compose(["up","-d","--no-recreate","--wait","--wait-timeout","90","postgres"]);
    check();
  } else if (action === "check") check();
  else if (action === "sentinel-create") sentinel(true);
  else if (action === "sentinel-check") sentinel();
  else if (action === "backup") await backup();
  else if (action === "verify-backup") await verifyBackup(process.argv[3]);
  else if (action === "restart-test") {
    sentinel(); compose(["restart","postgres"]);
    compose(["up","-d","--no-recreate","--wait","--wait-timeout","90","postgres"]); sentinel();
  } else if (action === "stop-start-test") {
    sentinel(); compose(["stop","postgres"]);
    compose(["up","-d","--no-recreate","--wait","--wait-timeout","90","postgres"]); sentinel();
  } else throw Error("Use init, validate, start, check, sentinel-create, sentinel-check, backup, verify-backup <path>, restart-test, or stop-start-test.");
}
module.exports = {validateConfig, validateRuntime, validateVolume};
if (require.main === module) main(process.argv[2]).catch(error => {
  console.error(error instanceof SafeFailure ? error.message : "Physical acceptance operation FAILED. Stop; check persistence, health, local credentials and authorized migration prerequisites. No secret output.");
  process.exitCode=1;
});
