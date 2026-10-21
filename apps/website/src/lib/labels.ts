/**
 * Customer-facing words for OPA's internal codes. Anything not listed becomes a
 * readable sentence ("SOS_BUTTON" -> "SOS button"); a code is never shown raw.
 */
const WORDS: Record<string, string> = {
  FACILITY_ADMIN: "Facility Administrator",
  FACILITY_OPERATOR: "Facility Operator",
  TECHNICAL_SUPPORT: "OPA Technical Support",
  ADMIN: "OPA Super Admin",
  ORGANIZATION_ADMIN: "Head Office Administrator",
  USER: "Member",
  SOS_BUTTON: "SOS button",
  VOICE_TRIGGER: "Voice trigger",
  LOCK_SCREEN: "Lock screen",
  SAFEWALK: "SafeWalk",
  SAFEWALK_EMERGENCY: "SafeWalk emergency",
  MANUAL: "Manual",
  STANDARD: "Standard",
  SILENT: "Silent",
  PROVIDER_ACCEPTED: "Accepted for delivery",
  DELIVERED: "Delivered",
  FAILED: "Not delivered",
  QUEUED: "Waiting to send",
  CONFIGURED: "Configured",
  NOT_CONFIGURED: "Not configured",
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  PENDING: "Pending",
  ESTATE: "Estate",
  SCHOOL: "School",
  BANK: "Bank",
  ORGANIZATION: "Organization",
  SECURITY_PROVIDER: "Security provider",
  GOVERNMENT_AGENCY: "Government agency",
  POLICE_STATION: "Police station",
  FIRE_STATION: "Fire station",
  NGO: "NGO",
  OTHER: "Other",
  SMS: "SMS",
  EMAIL: "Email",
  AIR: "After-incident report",
};
const KEEP_UPPER = new Set(["SOS", "SMS", "OPA", "AIR", "NGO", "HSE", "ID", "PDF", "CSV"]);

export function label(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value).trim();
  if (WORDS[raw]) return WORDS[raw];
  if (!/^[A-Z0-9_ ]+$/.test(raw)) return raw; // already human text
  const words = raw.split(/[_ ]+/).filter(Boolean).map((w, i) => (KEEP_UPPER.has(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()));
  return words.join(" ");
}
