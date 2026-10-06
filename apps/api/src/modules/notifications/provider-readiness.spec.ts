import { randomBytes } from "node:crypto";
import { providerReadiness } from "./provider-readiness";
describe("safe provider readiness",()=>{
 it("reports missing configuration without pretending to send",()=>{const result=providerReadiness({});expect(result.sms.state).toBe("NOT_CONFIGURED");expect(result.email.state).toBe("NOT_CONFIGURED");});
 it("does not disclose configured values or claim valid credentials",()=>{const secret=randomBytes(32).toString("hex");const result=providerReadiness({AFRICASTALKING_API_KEY:secret,AFRICASTALKING_USERNAME:"sandbox",RESEND_API_KEY:secret,RESEND_FROM_ADDRESS:"delivery@example.test"});expect(result.sms.state).toBe("CONFIGURED");expect(result.email.credentialValidity).toBe("UNKNOWN");expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(result)).not.toContain("delivery@example.test");});
 it("treats whitespace as missing",()=>expect(providerReadiness({RESEND_API_KEY:" ",RESEND_FROM_ADDRESS:" "}).email.state).toBe("NOT_CONFIGURED"));
});
