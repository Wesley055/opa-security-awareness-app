// Restored from the iOS build 5 working copy (7 Oct backup), adapted: the
// Porcupine provider is not split per platform here; voice-protection-service
// loads it only on Android (see voice-protection-service.ts).
import * as protection from "../../modules/opa-protection/index.ios";
jest.mock("@picovoice/porcupine-react-native", () => { throw new Error("Android voice library must not load on iOS"); });
jest.mock("expo-modules-core", () => { throw new Error("Android protection module must not load on iOS"); });

it("iOS protection safely starts and stops without loading the Android native module", async () => {
  expect(protection.emergencyTrackingNative()).toBeNull();
  await expect(protection.startOpaProtectionService()).resolves.toBeUndefined();
  await expect(protection.stopOpaProtectionService()).resolves.toBeUndefined();
  expect(protection.addOpaVoiceTriggerListener(jest.fn()).remove).toEqual(expect.any(Function));
});
