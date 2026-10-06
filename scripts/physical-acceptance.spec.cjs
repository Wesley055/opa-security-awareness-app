const {test}=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const {validateConfig,validateRuntime,validateVolume}=require("./physical-acceptance.cjs");
function config(){return {services:{postgres:{
  image:"postgres:16-alpine",container_name:"opa-physical-acceptance-persistent",
  environment:{POSTGRES_DB:"opa_delegation_acceptance",POSTGRES_USER:"opa_acceptance",POSTGRES_PASSWORD:crypto.randomBytes(32).toString("hex")},
  ports:[{host_ip:"127.0.0.1",published:"55442",target:5432}],
  volumes:[{type:"volume",source:"physical_pgdata",target:"/var/lib/postgresql/data"}],
}},volumes:{physical_pgdata:{name:"opa_delegation_physical_acceptance_pgdata"}}};}
function runtime(){return {
  Name:"/opa-physical-acceptance-persistent",
  Config:{Image:"postgres:16-alpine",Labels:{"opa.purpose":"physical-acceptance"},
    Env:["PGDATA=/var/lib/postgresql/data","POSTGRES_DB=opa_delegation_acceptance","POSTGRES_USER=opa_acceptance"]},
  HostConfig:{PortBindings:{"5432/tcp":[{HostIp:"127.0.0.1",HostPort:"55442"}]}},
  Mounts:[{Type:"volume",Name:"opa_delegation_physical_acceptance_pgdata",Destination:"/var/lib/postgresql/data",RW:true}],
};}
test("accepts exact persistent configuration",()=>validateConfig(config()));
test("accepts exact persistent runtime",()=>validateRuntime(runtime()));
for(const [name,change] of [
  ["tmpfs",c=>c.services.postgres.tmpfs=["/var/lib/postgresql/data"]],
  ["tmpfs mount",c=>c.services.postgres.volumes[0].type="tmpfs"],
  ["anonymous volume",c=>delete c.volumes.physical_pgdata.name],
  ["alternate data directory",c=>c.services.postgres.environment.PGDATA="/tmp/data"],
  ["extra mount",c=>c.services.postgres.volumes.push({type:"tmpfs",target:"/tmp"})],
  ["foreign database",c=>c.services.postgres.environment.POSTGRES_DB="production"],
  ["public port",c=>c.services.postgres.ports[0].host_ip="0.0.0.0"],
  ["historical port",c=>c.services.postgres.ports[0].published="55439"],
  ["inherited mounts",c=>c.services.postgres.volumes_from=["historical"]],
])test("rejects config "+name,()=>{const c=config();change(c);assert.throws(()=>validateConfig(c));});
for(const [name,change] of [
  ["tmpfs",c=>c.HostConfig.Tmpfs={"/var/lib/postgresql/data":""}],
  ["wrong volume",c=>c.Mounts[0].Name="anonymous-id"],
  ["bind mount",c=>c.Mounts[0].Type="bind"],
  ["read-only mount",c=>c.Mounts[0].RW=false],
  ["missing label",c=>c.Config.Labels={}],
  ["changed data directory",c=>c.Config.Env[0]="PGDATA=/tmp/data"],
  ["automated port",c=>c.HostConfig.PortBindings["5432/tcp"][0].HostPort="55441"],
])test("rejects runtime "+name,()=>{const c=runtime();change(c);assert.throws(()=>validateRuntime(c));});
test("new physical database name remains protected by the existing test guard",()=>{
  const {assertNotPhysical,assertDisposableTestUrl}=require("../apps/api/scripts/destructive-test-target.cjs");
  const u="postgresql://127.0.0.1:55442/opa_delegation_acceptance";
  assert.throws(()=>assertNotPhysical(u),/PHYSICAL_ACCEPTANCE_DATABASE_PROTECTED/);
  assert.throws(()=>assertDisposableTestUrl(u,"opa_delegation_acceptance"));
});
test("git ignores local credentials, receipts and backup files",()=>{
  const root=path.resolve(__dirname,"..");
  const paths=[".local/physical-acceptance/postgres.env",".local/physical-acceptance/sentinel.json","backups/test.dump","test.pgdump","test.backup"];
  const r=cp.spawnSync("git",["-c","safe.directory="+root.replaceAll("\\","/"),"check-ignore","--stdin"],{cwd:root,input:paths.join("\n"),encoding:"utf8"});
  assert.equal(r.status,0);assert.deepEqual(r.stdout.trim().split(/\r?\n/),paths);
});
test("tooling has no automatic migrations, restore, tenant bootstrap or destructive volume commands",()=>{
  const s=fs.readFileSync(path.join(__dirname,"physical-acceptance.cjs"),"utf8");
  assert.doesNotMatch(s,/migrate deploy|migrate reset|db push|volume prune|system prune|down","-v/);
  assert.match(s,/pg_restore","--list/);
  assert.doesNotMatch(s,/pg_restore","--dbname/);
});
test("real Docker Compose resolves to validated named persistence without starting anything",()=>{
  const r=cp.spawnSync("docker",["compose","-f",path.resolve(__dirname,"../ops/physical-acceptance/compose.yml"),"config","--format","json"],
    {env:{...process.env,OPA_PHYSICAL_POSTGRES_PASSWORD:crypto.randomBytes(32).toString("hex")},encoding:"utf8",windowsHide:true,timeout:30000});
  assert.equal(r.status,0,"Compose validation failed (output withheld)");
  validateConfig(JSON.parse(r.stdout));
});

test("rejects tmpfs hidden behind a named volume driver",()=>{
 const c=config();c.volumes.physical_pgdata.driver_opts={type:"tmpfs"};assert.throws(()=>validateConfig(c));
 assert.throws(()=>validateVolume({Name:"opa_delegation_physical_acceptance_pgdata",Driver:"local",Scope:"local",Options:{type:"tmpfs"}}));
});
test("accepts local persistent volume without driver options",()=>validateVolume({Name:"opa_delegation_physical_acceptance_pgdata",Driver:"local",Scope:"local",Options:null}));
