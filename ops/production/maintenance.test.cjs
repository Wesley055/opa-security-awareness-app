'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('./maintenance.cjs');
const manifest=()=>({releaseId:'test',migration:{writersQuiesced:true},maintenance:{mode:'full-maintenance',acceptedOutage:true,noActiveUsersVerified:true,activityEvidenceSHA256:'a'.repeat(64),communicationReference:'fixture notice',start:'2026-10-14T10:00:00Z',end:'2026-10-14T10:30:00Z'}});
const now=()=>Date.parse('2026-10-14T10:05:00Z');
test('maintenance binds outage acceptance, active-user evidence, notice and bounded window',()=>{
 assert.equal(M.acceptance(manifest(),now()).mode,'full-maintenance');
 for(const change of [m=>m.maintenance.noActiveUsersVerified=false,m=>m.maintenance.acceptedOutage=false,m=>m.maintenance.activityEvidenceSHA256='',m=>m.maintenance.communicationReference='',m=>m.maintenance.end='2026-10-14T11:00:00Z',m=>m.migration.emergencyWriterException={}]){const m=manifest();change(m);assert.throws(()=>M.acceptance(m,now()))}
});
test('expired window never admits maintenance',()=>assert.throws(()=>M.acceptance(manifest(),Date.parse('2026-10-14T10:30:00Z')),/MAINTENANCE_WINDOW/));
test('active incident blocks before any writer shutdown',async()=>{
 const queries=[],db={query:async q=>{queries.push(q);if(q.includes('pg_try_advisory_lock'))return {rows:[{held:true}]};if(q.includes('DISTINCT r.rolname'))return {rows:[]};if(q.includes('rolcanlogin'))return {rows:[{rolcanlogin:true}]};return {rows:[{n:q.includes('"Incident"')?1:0}]}}};
 await assert.rejects(M.enter(db,manifest(),async()=>{},now),/ACTIVITY_REQUIRES_RECONCILIATION/);assert(!queries.some(q=>q.includes('ALTER ROLE')||q.includes('pg_terminate_backend')));
});
test('unexpected writer identity blocks before any writer shutdown',async()=>{
 const queries=[],db={query:async q=>{queries.push(q);return {rows:q.includes('pg_try_advisory_lock')?[{held:true}]:[{rolname:'unexpected_writer'}]}}};
 await assert.rejects(M.enter(db,manifest(),async()=>{},now),/UNCONTROLLED_DATABASE_WRITER/);assert(!queries.some(q=>q.includes('ALTER ROLE')));
});
test('read-only startup and restoration require exact phase and schema42',async()=>{
 const db={query:async()=>{throw Error('UNEXPECTED_DB_OPERATION')}};
 await assert.rejects(M.readOnlyStartup(db,{phase:'intent'},async()=>{}),/MAINTENANCE_PHASE/);
 await assert.rejects(M.restore(db,{phase:'read-only-startup'},{validatedSchema:35,validatedBuild:'legacy',allowedBuilds:['legacy']},async()=>{}),/VERIFIED_API42_RECOVERY_REQUIRED/);
});
test('effective write privilege including PUBLIC or inherited grants rejects startup fence',async()=>await assert.rejects(M.assertReadOnly({query:async()=>({rows:[{writable:true}]})}),/WRITE_FENCE_INCOMPLETE/));
test('drain rejects unrelated sessions and prepared transactions',async()=>{
 for(const kind of ['session','prepared']){
  const db={query:async q=>({rows:q.includes('rolcanlogin')?[{rolcanlogin:false}]:q.includes('pg_stat_activity')?(kind==='session'?[{pid:4,usename:'unknown'}]:[]):[{n:1}]})};
  await assert.rejects(M.verifyFence(db),/NOT_DRAINED/);
 }
});


test('terminal uncertainty is accepted only with the exact reviewed retained-record binding',async()=>{
 const C=require('./contract.cjs'),rows=[{id:'synthetic-reference',digest:'a'.repeat(64)}];
 const db={query:async sql=>({rows:sql.includes('count(*)')?[{n:0}]:sql.includes('IncidentNotification')?rows:[]})};
 await assert.rejects(M.activity(db),/RETAINED_ACTIVITY_BINDING_CHANGED/);
 const bindings=await M.retainedActivity(db);const result=await M.activity(db,bindings);assert.equal(result.emergencyNotifications,0);assert.equal(result.retainedActivity.notifications.sha256,C.hash(JSON.stringify(rows)));
 await assert.rejects(M.activity(db,{...bindings,notifications:{...bindings.notifications,sha256:'0'.repeat(64)}}),/RETAINED_ACTIVITY_BINDING_CHANGED/);
});
