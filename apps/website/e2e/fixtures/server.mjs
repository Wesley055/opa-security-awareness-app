// Isolated browser/component fixture only. Never imported by src or used by institutional tests.
import http from 'node:http';import {createHash} from 'node:crypto';
const facility={id:'11111111-1111-4111-8111-111111111111',name:'Fixture Facility — browser validation only',type:'SECURITY_PROVIDER',isActive:true,isVerified:false};
const resident={id:'22222222-2222-4222-8222-222222222222',firstName:'[protected]',lastName:'[protected]',email:'[protected]',phoneNumber:'[protected]',role:'USER',isActive:true,accountStatus:'PENDING_ACTIVATION'};
const operator={...resident,id:'33333333-3333-4333-8333-333333333333',firstName:'[protected]',lastName:'[protected]',role:'FACILITY_OPERATOR',accountStatus:'ACTIVE'};
const now='2026-09-10T12:00:00.000Z';
const incident={id:'44444444-4444-4444-8444-444444444444',status:'ACTIVE',trigger:'SOS_BUTTON',latitude:null,longitude:null,address:null,voicePhrase:null,lastTriggeredAt:now,retriggerCount:1,createdAt:now,updatedAt:now,resolvedAt:null,journeySessionId:null,user:{firstName:resident.firstName,lastName:resident.lastName}};
const evidence={id:'55555555-5555-4555-8555-555555555555',type:'DOCUMENT',status:'STORED',createdAt:now,capturedAt:now,uploadedAt:now,mimeType:'text/plain',sizeBytes:'7',sha256:createHash('sha256').update('fixture').digest('hex'),storageKey:'test-only-object-path'};
const invitation={resident:{id:resident.id,facilityId:facility.id,isActive:true,accountStatus:'PENDING_ACTIVATION',activatedAt:null},latest:{id:'delivery-fixture',channel:'SMS',status:'QUEUED',queuedAt:now,nextAttemptAt:null,attemptCount:1},history:[],canResend:false,resendAvailableAt:null};
http.createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;let body={};try{body=JSON.parse(data||'{}');}catch{}
 const url=new URL(req.url,'http://127.0.0.1:4901'),role=String(req.headers.authorization??'').replace('Bearer fixture.','');
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(url.pathname==='/health')return send(200,{purpose:'browser fixtures only'});
 if(url.pathname==='/auth/login'){const role=body.email==='admin@fixture.test'?'ADMIN':body.email==='facilityadmin@fixture.test'?'FACILITY_ADMIN':'FACILITY_OPERATOR';return send(200,{accessToken:'fixture.'+role,refreshToken:'fixture-refresh',user:{role}});}
 if(url.pathname==='/auth/activate')return send(200,{accessToken:'fixture-secret',refreshToken:'fixture-refresh'});
 if(!['ADMIN','FACILITY_ADMIN','FACILITY_OPERATOR'].includes(role))return send(401,{});
 if(url.pathname==='/users/me')return send(200,{id:'fixture-'+role,firstName:'Fixture',lastName:role,role,isActive:true,facilityId:role==='ADMIN'?null:facility.id,facility:role==='ADMIN'?null:facility});
 if(url.pathname==='/admin/facilities')return send(200,{facilities:[facility],nextCursor:null});
 if(url.pathname==='/admin/facilities/'+facility.id)return send(200,{facility});
 if(url.pathname==='/admin/facilities/'+facility.id+'/members')return send(200,{facility,members:[{...operator,membershipState:'ACTIVE'}],nextCursor:null});
 if(url.pathname==='/admin/facilities/'+facility.id+'/invitations')return send(200,{invitations:[{id:'66666666-6666-4666-8666-666666666666',requestedRole:'FACILITY_ADMIN',status:'VERIFICATION_PENDING',expiresAt:now,deliveries:[{id:'delivery-test',channel:'EMAIL',status:'SENT',attemptCount:1}]}],nextCursor:null});
 if(url.pathname==='/admin/facilities/'+facility.id+'/audit')return send(200,{events:[],nextCursor:null});
 if(url.pathname==='/facility-admin/facility/residents/enrollments')return send(200,{requests:[]});
 if(url.pathname==='/operator/incidents')return send(200,{incidents:[incident],hasMore:false,nextCursor:null});
 if(url.pathname==='/operator/facility/members'||url.pathname==='/admin/facilities/'+facility.id+'/members')return send(200,{facility,operators:[operator],residents:[resident]});
 if(url.pathname==='/facility-admin/facility/residents')return send(200,{facility,residents:[resident]});
 if(url.pathname.endsWith('/invitation'))return send(200,invitation);
 if(url.pathname==='/incidents/'+incident.id)return send(200,incident);
 if(url.pathname.endsWith('/tracking'))return send(200,{state:'NO_SESSION',latest:null,points:[],lastFixReceivedAt:null,serverTime:now});
 if(url.pathname.endsWith('/timeline/verify'))return send(200,{valid:true});
 if(url.pathname.endsWith('/timeline'))return send(200,[{sequence:1,type:'INCIDENT_CREATED',occurredAt:now,source:'MOBILE',display:{trigger:'SOS_BUTTON'}}]);
 if(url.pathname.endsWith('/evidence'))return send(200,[evidence]);
 // No fake Azure signed grant. Browser tests must see the genuine unavailable/retry state.
 return send(503,{message:'Fixture capability is not supplied.'});
}).listen(4901,'127.0.0.1');
