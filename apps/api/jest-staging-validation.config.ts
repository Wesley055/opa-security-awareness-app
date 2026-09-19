import type { Config } from "jest";
import base from "./jest-int.config";

const config: Config = {
  ...base,
  globalSetup: "<rootDir>/test/int/staging-validation-global-setup.ts",
};

export default config;
