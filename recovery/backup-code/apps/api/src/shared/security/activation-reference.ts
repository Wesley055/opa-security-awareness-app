import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function key(config:ConfigService,purpose:string):Buffer {
 const master=config.getOrThrow<string>("ENROLLMENT_ENCRYPTION_KEY");if(!/^[a-f0-9]{64}$/i.test(master))throw new Error("Invalid activation encryption configuration");
 return createHmac("sha256",Buffer.from(master,"hex")).update("OPA_ACTIVATION_REFERENCE:"+purpose).digest();
}
function seal(config:ConfigService,purpose:string,data:Buffer):string {
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(config,purpose),iv);cipher.setAAD(Buffer.from(purpose));
 const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);return purpose+"."+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");
}
function open(config:ConfigService,purpose:string,value:string,size:number):Buffer {
 const pattern=new RegExp("^"+purpose+"\\.[A-Za-z0-9_-]+$");if(!pattern.test(value)||value.length>128)throw new Error("Invalid reference");
 const data=Buffer.from(value.slice(purpose.length+1),"base64url");if(data.length!==28+size)throw new Error("Invalid reference");
 const decipher=createDecipheriv("aes-256-gcm",key(config,purpose),data.subarray(0,12));decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]);
}
/** Navigation never authorizes activation; current authority and both contact proofs remain required. */
export function activationReference(config:ConfigService,id:string):string {
 if(!uuid.test(id))throw new Error("Invalid enrollment reference");return seal(config,"a1",Buffer.from(id.replaceAll("-",""),"hex"));
}
export function resolveActivationReference(config:ConfigService,value:string):string {
 // Previously delivered UUID navigation remains subject to exactly the same dual-proof checks.
 if(uuid.test(value))return value;
 try{const hex=open(config,"a1",value,16).toString("hex");const id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");if(!uuid.test(id))throw new Error();return id;}
 catch{throw new BadRequestException("Invitation unavailable. Check your invitation or contact your administrator.");}
}
export function legacyActivationReference(config:ConfigService,hash:string):string {if(!/^[a-f0-9]{64}$/.test(hash))throw new Error("Invalid resident verifier");return seal(config,"a2",Buffer.from(hash,"hex"));}
export function matchesLegacyActivationReference(config:ConfigService,reference:string,hash:string):boolean {
 try{const actual=open(config,"a2",reference,32),expected=Buffer.from(hash,"hex");return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}
}
