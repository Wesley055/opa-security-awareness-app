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
  const webOrigin = process.env.OPA_WEB_URL;
  if (environment === "production" && !webOrigin) throw new Error("OPA_WEB_URL is required for production activation links");
  const web = webOrigin ? new URL(webOrigin) : null;
  if (
    web &&
    (web.protocol !== "https:" ||
      web.username ||
      web.password ||
      web.pathname !== "/" ||
      web.search ||
      web.hash)
  )
    throw new Error("OPA_WEB_URL must be a canonical HTTPS origin");
  return {
    ...config,
    name: config.name ?? "OPA",
    slug: config.slug ?? "opa",
    extra,
    ios: {
      ...config.ios,
      ...(web ? { associatedDomains: [`applinks:${web.hostname}`] } : {}),
    },
    android: {
      ...config.android,
      ...(web
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [
                  {
                    scheme: "https",
                    host: web.hostname,
                    pathPrefix: "/enroll",
                  },
                  {
                    scheme: "https",
                    host: web.hostname,
                    pathPrefix: "/activate",
                  },
                ],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
  };
};
