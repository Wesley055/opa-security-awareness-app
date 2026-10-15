'use strict';
// Isolated compatibility check: exact packaged business JavaScript, local PG,
// synthetic settings, providers disabled, no production policy or dispatch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),input=JSON.parse(fs.readFileSync(0)),u=new URL(input.url);
if(u.hostname!=='127.0.0.1'||u.username!=='opa_production_runtime'||u.pathname!=='/opa-api-production-database'||Number(u.port)<20000)throw Error('LOCAL_SYNTHETIC_DATABASE_ONLY');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),manifest=JSON.parse(fs.readFileSync(input.manifest));let verified=0;
for(const [name,value] of Object.entries(manifest.files))if(name.startsWith('apps/api/dist/')&&name.endsWith('.js')){
 const expected=typeof value==='string'?value:value.sha256;if(hash(fs.readFileSync(path.join(root,name)))!==expected)throw Error('PACKAGED_BUSINESS_JAVASCRIPT_DRIFT');verified++;
}
const {env}=require(root+'/packages/environment-policy/fixtures.cjs').fixture('development');
for(const k of Object.keys(process.env))if(!['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','COMSPEC'].includes(k.toUpperCase()))delete process.env[k];
Object.assign(process.env,env,{DATABASE_URL:input.url,OPA_ENVIRONMENT:'development',NODE_ENV:'test',OPA_NOTIFICATION_MODE:'disabled',OPA_BOOT_WITH_SUPPRESSED_MOCKS:'true',OPA_SSO_ENABLED:'false',AZURE_STORAGE_CONNECTION_STRING:'UseDevelopmentStorage=true',AZURE_STORAGE_CONTAINER:'synthetic',ALLOWED_ORIGINS:'http://127.0.0.1',OPA_WEB_URL:'https://synthetic.example.invalid'});
for(const k of ['OPA_DEPLOYMENT_RESOURCE_ID','OPA_ENVIRONMENT_POLICY_FILE','WEBSITE_INSTANCE_ID','REDIS_URL','RESEND_API_KEY','AFRICASTALKING_API_KEY'])delete process.env[k];
let app,db;
(async()=>{try{
 const {PrismaClient}=require(root+'/node_modules/@prisma/client');db=new PrismaClient({datasourceUrl:input.url});
 const authority=await db.$queryRawUnsafe("SELECT has_table_privilege(current_user,'public.\"Incident\"','INSERT,UPDATE,DELETE') AS writable");
 if(authority[0].writable!==Boolean(input.restored))throw Error('MAINTENANCE_RUNTIME_ACL_STATE');
 await require(root+'/apps/api/dist/shared/config/environment.js').initializeEnvironment();
 const {NestFactory}=require(root+'/node_modules/@nestjs/core'),{AppModule}=require(root+'/apps/api/dist/app.module.js');
 app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});await app.listen(0,'127.0.0.1');
 const origin='http://127.0.0.1:'+app.getHttpServer().address().port,status={};
 for(const route of ['/health','/health/ready','/health/environment']){status[route]=(await fetch(origin+route)).status;if(status[route]!==200)throw Error('ISOLATED_API_HEALTH_REJECTED')}
 if(input.restored)await db.$executeRawUnsafe('UPDATE public."Incident" SET status=status WHERE false');
 console.log(JSON.stringify({status:'PASS',artifactBuild:manifest.build,businessJavaScriptFilesVerified:verified,freshProcess:true,schema:42,readOnly:!input.restored,health:status,dispatch:false,productionPolicySigned:false,productionAcceptance:false}));
 }catch(e){console.log(JSON.stringify({status:'FAIL',code:e.message,productionAcceptance:false}));process.exitCode=1}
 finally{if(app)await app.close();if(db)await db.$disconnect()}
})();
