import { loadEndpoint } from "../../../../packages/environment-policy/index.cjs";
/** Every upstream call resolves through this fail-closed boundary. */
export function environmentApiUrl(): string | null {
  try {
    return loadEndpoint(process.env);
  } catch {
    return null;
  }
}
