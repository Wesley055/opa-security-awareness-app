import base from "./jest-int.config";
export default {
  ...base,
  globalSetup: "<rootDir>/test/int/staging-validation-global-setup.ts",
};
