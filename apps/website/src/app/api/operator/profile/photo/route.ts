import { photoPost } from "@/lib/staff-profile-routes";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => photoPost("operator", request);
