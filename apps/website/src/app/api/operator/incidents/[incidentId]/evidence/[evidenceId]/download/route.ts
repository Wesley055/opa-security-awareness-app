import {reviewEvidence} from '@/lib/evidence-review';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{incidentId:string;evidenceId:string}>}){const {incidentId,evidenceId}=await params;return reviewEvidence(incidentId,evidenceId,request.signal);}
