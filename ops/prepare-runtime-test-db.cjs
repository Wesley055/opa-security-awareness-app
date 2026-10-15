const fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');const dotenv=require('dotenv');
const root=path.resolve(__dirname,'..');
async function main(){
 const source=process.argv[2];const config=dotenv.parse(fs.readFileSync(source));const u=new URL(config.DATABASE_URL);
 if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('LOOPBACK_ONLY');
 const name='opa_durable_runtime_20261013_test';u.pathname='/postgres';u.search='';
 const c=new Client({connectionString:u.toString(),connectionTimeoutMillis:5000});await c.connect();
 try{if((await c.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)throw Error('NEW_DATABASE_ONLY');await c.query('CREATE DATABASE "'+name+'"');}finally{await c.end()}
 u.pathname='/'+name;
 fs.writeFileSync(path.join(root,'apps/api/.env.test.local'),'DATABASE_URL='+u.toString()+'\nNODE_ENV=test\n',{flag:'wx'});
 console.log(JSON.stringify({database:name,loopbackOnly:true,productionContacted:false}));
}
main().catch(()=>{console.error('ISOLATED_TEST_DATABASE_PREPARATION_FAILED');process.exitCode=1});
