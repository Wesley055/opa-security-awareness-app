import { profileGet, profilePost } from "@/lib/staff-profile-routes";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => profileGet("institutional", request);
export const POST = (request: Request) => profilePost("institutional", request);
