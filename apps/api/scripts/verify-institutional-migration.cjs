// Disposable migration classification rehearsal. Never accepts production URLs.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const root=path.resolve(__dirname,'..');
const values=require('dotenv').parse(fs.readFileSync(path.join(root,'.env.test.local')));
const url=new URL(values.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55439'||!url.pathname.endsWith('_test')) throw Error('Disposable database boundary required');
const name='opa_authority_'+randomUUID().replaceAll('-','')+'_test';
(async()=>{
 const control=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000});await control.connect();
 await control.query('CREATE DATABASE "'+name+'"');await control.end();url.pathname='/'+name;
 const db=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000});await db.connect();
 try{
  const dirs=fs.readdirSync(path.join(root,'prisma/migrations')).filter(x=>fs.existsSync(path.join(root,'prisma/migrations',x,'migration.sql'))).sort();
  for(const dir of dirs.filter(x=>x<'20260928010000')) await db.query(fs.readFileSync(path.join(root,'prisma/migrations',dir,'migration.sql'),'utf8'));
  const a=randomUUID(),b=randomUUID(),u=randomUUID(),inactive=randomUUID();
  await db.query('INSERT INTO "Facility" (id,name,type,"updatedAt") VALUES ($1,$2,$5,now()),($3,$4,$5,now())',[a,'Synthetic commissioned',b,'Synthetic zero admin','OTHER']);
  for(const [id,active,role] of [[u,true,'FACILITY_ADMIN'],[inactive,false,'USER']]) await db.query('INSERT INTO "User" (id,email,"phoneNumber","firstName","lastName",role,"facilityId","isActive","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',[id,randomUUID()+'@example.test',randomUUID(),'Synthetic','Classification',role,a,active]);
  for(const dir of dirs.filter(x=>x>='20260928010000')) await db.query(fs.readFileSync(path.join(root,'prisma/migrations',dir,'migration.sql'),'utf8'));
  const rows=(await db.query('SELECT id,"membershipState","isActive" FROM "User" ORDER BY id')).rows;
  if(rows.find(x=>x.id===inactive).membershipState!=='SUSPENDED'||rows.find(x=>x.id===inactive).isActive!==false) throw Error('Inactive classification failed');
  const facilities=(await db.query('SELECT id,"commissionedAt" FROM "Facility"')).rows;
  if(!facilities.find(x=>x.id===a).commissionedAt||facilities.find(x=>x.id===b).commissionedAt!==null) throw Error('Commission classification failed');
  let rejected=false;try{await db.query('UPDATE "User" SET "isActive"=false WHERE id=$1',[u])}catch(e){if(e.code==='23514')rejected=true;else throw e;}
  if(!rejected)throw Error('Last administrator constraint failed');
  console.log(JSON.stringify({database:name,migrations:dirs.length,existingDataClassification:'PASS',zeroAdmin:'PASS',lastAdminConstraint:'PASS',destructiveRollback:'NOT_SUPPORTED',retainedForInspection:true}));
 } finally{await db.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
