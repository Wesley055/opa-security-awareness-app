export type Environment = "development" | "staging" | "production";
export type Variables = Record<string, string | undefined>;
export interface Diagnostic {
  environment: Environment;
  build?: string;
  databaseEnvironment: string;
  redisEnvironment: string;
  notificationMode: string;
  ssoEnabled: boolean;
  migrationReadiness: string;
}
export function classify(env: Variables): Environment;
export function preflight(
  env: Variables,
  purpose?: "api" | "migration",
): Diagnostic;
export function loadEndpoint(env: Variables): string | null;
export function hash(value: string): string;
export function readPolicy(
  file: string | undefined,
  environment: string,
  purpose: string,
): {
  resources: { database: { database: string; role: string } };
  ssoBindings: unknown;
};
export function validateApi(env: Variables, policy: unknown): Diagnostic;
export function endpoint(env: Variables, policy: unknown): string | null;
