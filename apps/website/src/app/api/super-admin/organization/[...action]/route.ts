import { NextResponse } from "next/server";
import { AdminFailure, requireAdmin, upstream } from "@/lib/super-admin-api";
import { institutionalProjection } from "@/lib/institutional-path";
import { governancePath } from "@/lib/governance-path";
async function handle(request:Request,{params}:{params:Promise<{action:string[]}>}) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer"}});
 try {
  const path=(await params).action.join("/");const target=governancePath(path,request.method);if(!target)throw new AdminFailure(404);
  if(request.method==="POST"&&request.headers.get("origin")!==new URL(request.url).origin)throw new AdminFailure(403);
  const {access,actorId}=await requireAdmin();
  if(request.method==="POST"&&request.headers.get("x-platform-actor")!==actorId)throw new AdminFailure(403);
  let body:Record<string,unknown>|undefined;
  if(request.method==="POST"){const text=await request.text();if(text.length>16384)throw new AdminFailure(413);body=JSON.parse(text);if(!body||typeof body!=="object"||Array.isArray(body))throw new AdminFailure(400);}
  const data=await upstream(target,access,body,request.headers.get("idempotency-key")??undefined);
  if(path==="overview")return json({actor:institutionalProjection(data.actor),organizations:data.organizations.map((r:{id:string;name:string})=>({id:r.id,name:r.name})),facilities:institutionalProjection(data.facilities),assignments:institutionalProjection(data.assignments),elevations:institutionalProjection(data.elevations),employmentCount:data.employmentCount,openIncidents:data.openIncidents,limit:data.limit});
  return json(institutionalProjection(data));
 }catch(error){const status=error instanceof AdminFailure?error.status:503;return json({error:status===401||status===403?"Current Super Admin authority is required.":"The operation could not be confirmed. Review current state before retrying."},status);}
}
export const GET=handle;export const POST=handle;
