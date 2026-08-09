import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiBaseUrl = process.env.OPA_API_BASE_URL?.trim();

  const extra = {
    ...config.extra,
  };

  delete extra.apiBaseUrl;

  if (apiBaseUrl !== undefined && apiBaseUrl.length > 0) {
    extra.apiBaseUrl = apiBaseUrl;
  }

  return {
    ...config,
    extra,
  };
};
