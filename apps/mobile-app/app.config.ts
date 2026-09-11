import type { ConfigContext, ExpoConfig } from "expo/config";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  classify,
  loadEndpoint,
} from "../../packages/environment-policy/index.cjs";
export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = classify(process.env);
  const apiBaseUrl = loadEndpoint(process.env);
  if (environment !== "development")
    execFileSync(
      process.execPath,
      [
        resolve(
          __dirname,
          "../../packages/environment-policy/verify-endpoint.cjs",
        ),
      ],
      { env: process.env, stdio: "pipe", timeout: 15_000 },
    );
  const extra = { ...config.extra };
  delete extra.apiBaseUrl;
  extra.environment = environment;
  extra.endpointEnvironment = environment;
  extra.verifiedApiOrigin = apiBaseUrl;
  if (apiBaseUrl) extra.apiBaseUrl = apiBaseUrl;
  return {
    ...config,
    name: config.name ?? "OPA",
    slug: config.slug ?? "opa",
    extra,
  };
};
