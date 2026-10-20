"use client";
import { StaffProfile } from "@/components/console/staff-profile";
export function ProfileClient() {
  return <StaffProfile session="operator" onSignedOut={() => window.location.assign("/operator/login")} />;
}
