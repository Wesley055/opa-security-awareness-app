import 'server-only';
import {createHash} from 'node:crypto';
import {apiUrl,getAccessToken} from './operator-session';
import {consoleApi,object} from './console-api';
const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const failure=(status:number,error:string)=>Response.json({error},{status,headers});
const MAX_BYTES=50*1024*1024;

export function safeEvidenceUrl(value:string,now=Date.now()): URL | null {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||! /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/i.test(url.hostname))return null;
    const expiry=Date.parse(url.searchParams.get('se')??'');
    if(!Number.isFinite(expiry)||expiry<=now||expiry-now>6*60*1000||url.searchParams.get('sp')!=='r'||!url.searchParams.get('sig'))return null;
    return url;
  }catch{return null;}
}

/** Fetch and verify in the website server. SAS URL, storage path and upstream errors never reach the browser. */
export async function reviewEvidence(incidentId:string,evidenceId:string,signal?:AbortSignal):Promise<Response>{
  const base=apiUrl(),token=await getAccessToken();
  if(!token)return failure(401,'Your session ended.');
  if(!base)return failure(503,'Evidence review is temporarily unavailable.');
  const metadata=await consoleApi('/incidents/'+encodeURIComponent(incidentId)+'/evidence');
  if(metadata.status!==200)return failure(metadata.status,metadata.error??'Evidence metadata is unavailable.');
  if(!Array.isArray(metadata.data))return failure(503,'Evidence metadata could not be verified.');
  const record=metadata.data.find(row=>object(row)&&row.id===evidenceId);
  if(!object(record)||record.status!=='STORED')return failure(404,'This evidence file is unavailable.');
  if(typeof record.sha256!=='string'||! /^[a-f0-9]{64}$/i.test(record.sha256))return failure(503,'A recorded integrity digest is required before review.');
  const expectedBytes=Number(record.sizeBytes);
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0||expectedBytes>MAX_BYTES)return failure(413,'This file exceeds the supported review limit.');
  const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  try{
    const granted=await fetch(base+'/incidents/'+encodeURIComponent(incidentId)+'/evidence/'+encodeURIComponent(evidenceId)+'/download-url',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:bounded,redirect:'error'});
    if(!granted.ok)return failure([401,403,404].includes(granted.status)?granted.status:503,'Evidence authorization failed. Refresh access and try again.');
    let raw=await granted.text();try{const decoded=JSON.parse(raw);if(typeof decoded==='string')raw=decoded;}catch{/* Nest may return a text response. */}
    const url=safeEvidenceUrl(raw);
    if(!url)return failure(410,'Evidence access expired or could not be validated. Request access again.');
    const file=await fetch(url,{cache:'no-store',redirect:'error',signal:bounded});
    if(!file.ok)return failure(file.status===403?410:file.status===404?404:503,'Evidence access expired or the file is unavailable. Request access again.');
    if(!file.body)return failure(503,'Evidence content is unavailable.');
    const reader=file.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>MAX_BYTES||length>expectedBytes){await reader.cancel();return failure(413,'Evidence size does not match the recorded file.');}chunks.push(chunk.value);}
    const bytes=Buffer.concat(chunks);
    if(length!==expectedBytes||createHash('sha256').update(bytes).digest('hex')!==record.sha256.toLowerCase())return failure(409,'Integrity verification failed. The file was not released.');
    const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf','audio/mpeg':'mp3','audio/mp4':'m4a','video/mp4':'mp4','text/plain':'txt'};
    const extension=typeof record.mimeType==='string'?extensions[record.mimeType]??'bin':'bin';
    return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="evidence.'+extension+'"','Content-Length':String(length),'X-OPA-Evidence-Integrity':'matches-recorded-sha256'}});
  }catch{return failure(503,'Evidence review could not complete. Request access again.');}
}
