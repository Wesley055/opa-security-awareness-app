import * as protection from "../../modules/opa-protection/index.ios";
import { PicovoicePorcupineProvider } from "./picovoice-porcupine-provider.ios";
jest.mock("@picovoice/porcupine-react-native",()=>{throw new Error("Android voice library must not load on iOS");});
jest.mock("expo-modules-core",()=>{throw new Error("Android protection module must not load on iOS");});
it("iOS protection safely starts and stops without Android native module loading",async()=>{expect(protection.emergencyTrackingNative()).toBeNull();await expect(protection.startOpaProtectionService()).resolves.toBeUndefined();await expect(protection.stopOpaProtectionService()).resolves.toBeUndefined();});
it("iOS voice provider never starts native listening",async()=>{const provider=new PicovoicePorcupineProvider({accessKey:"synthetic",keywordPath:"synthetic",phrase:"synthetic"});await provider.start(jest.fn());expect(provider.isRunning()).toBe(false);await provider.stop();});
