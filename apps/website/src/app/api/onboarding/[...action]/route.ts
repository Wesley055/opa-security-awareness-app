import { onboardingProxy } from "@/lib/onboarding-proxy";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string[] }> };
export async function GET(request: Request, context: Context) {
  return onboardingProxy(request, (await context.params).action, false);
}
export async function POST(request: Request, context: Context) {
  return onboardingProxy(request, (await context.params).action, false);
}
