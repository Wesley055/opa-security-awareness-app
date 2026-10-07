"use strict";
// This contract is intentionally specific to this reviewed seven-migration cutover.
// Later releases must review a new contract; never infer authorization from pending SQL.
const BASE = 'b02a851f6fbe369661e3e3fc68d02898851278ba';
const FORWARD = {
  '20260922230000_bounded_onboarding_authority':'ef567ceafd4f36c80e0ee647ee81c757d16865c6db77bb22e6b7c94e63bd0bce',
  '20260928010000_support_role':'fc96270a51700f30e5dca348bf2155b3a514eb67f0cbed131de889a5eb6b12d9',
  '20260928010100_institutional_authority':'460aaa54c3e385bfc7df55d7cc0be2b614c433bbb89cb535ea574f45c0afb5e0',
  '20260929090000_support_enrollment_provenance':'63b5099f6ca3e18834465f897230f9873bd7c454ef41f4d0129747718d9be8ce',
  '20260930010000_canonical_organization':'6e85451094f5d44c0b43415e07179eb9e2c95bae7a92435afe55c35e4b9e57fc',
  '20260930010100_operational_response_policy':'a99e91d1a1f833f9e6b5ace5561f6f9f0e0c1cf97d72fbceb4d6c158ec9f2195',
  '20261004010000_reporting_foundation_reconciled':'b8e7be2e4690c770ac12b56863ed9ed27d154d60810fc8ff2fa91b0a070245a9',
};
const DB = 'opa-api-production-database';
const HOST = 'opa-api-production-server.postgres.database.azure.com';
const RUNTIME = 'opa_production_runtime', MIGRATOR = 'opa_production_migrations';
const OWNER = 'opa_production_release_owner';
const EXISTING_TABLES = ['User','Facility','AdministrativeAuditEvent','EnrollmentRequest','IncidentTimelineEvent'];
// REFERENCES exposes column/constraint metadata to Prisma introspection without
// SELECT access to application data. It cannot be used for DDL in idle posture.
const BASELINE_TABLES = ['AccountInvitationDelivery','AdministrativeAuditEvent','DeliveryAttempt','DeliveryStatusEvent','EmergencyContact','EmergencyIntelligenceSnapshot','EnrollmentRequest','Evidence','Facility','IdentityAccessGrant','IdentityResolutionAudit','Incident','IncidentAccessToken','IncidentNotification','IncidentTimelineEvent','JourneyLocationFix','JourneySession','PasswordResetToken','ProtectedIdentifier','ProviderDeliveryReceipt','ProviderReference','SafeWalkAudit','SafeWalkEscalation','SafeWalkGuardianCode','SafeWalkGuardianGrant','SafeWalkNotice','SsoAuditEvent','SsoConfiguration','SsoExternalIdentity','SsoReplay','SsoTransaction','StagingNotificationBudget','User'];
const TABLES = ['OnboardingAuthorityGrant','SupportEmployment','SupportCapabilityGrant','Organization','FacilitySupportAssignment','SupportCase','TemporaryElevation','CommissioningEvidence','FacilityResponsePolicy','ReportingProjection','AfterIncidentReport','CorrectiveAction'];
const TYPES = ['OnboardingPermission','FacilityMembershipState','SupportEmploymentState','SupportCapability','FacilityOperationalState','SupportCaseStatus','CorrectiveActionStatus'];
const FUNCTIONS = ['protect_last_facility_admin','commission_facility_admin','protect_commissioning_evidence','synchronize_facility_operational_state'];
const SEQUENCES = ['SupportCase_sequence_seq'];
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function requireThat(value, code) { if (!value) throw Error(code); }
function onlyKeys(value, keys, code) {
  requireThat(value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>keys.includes(k)),code);
}
function ledger(rows, expected) {
  requireThat(Array.isArray(rows) && rows.length === Object.keys(expected).length, 'LEDGER_COUNT');
  const seen = new Set();
  for (const row of rows) {
    requireThat(row.finished_at && !row.rolled_back_at && expected[row.migration_name] === row.checksum && !seen.has(row.migration_name), 'LEDGER_DIVERGENCE');
    seen.add(row.migration_name);
  }
}
function backupEvidence(b, now = Date.now()) {
  onlyKeys(b,['version','server','database','publicAccess','retentionDays','observedAt','earliestRestoreDate','restorePoint','evidenceSha256','approvalId'],'BACKUP_FIELDS');
  requireThat(b?.version === 1 && b.server === 'opa-api-production-server' && b.database === DB && b.publicAccess === 'Disabled' && b.retentionDays === 7, 'BACKUP_TARGET');
  requireThat(Number.isFinite(Date.parse(b.observedAt)) && now - Date.parse(b.observedAt) >= 0 && now - Date.parse(b.observedAt) < 3600000, 'BACKUP_STALE');
  requireThat(Number.isFinite(Date.parse(b.restorePoint)) && Date.parse(b.restorePoint) <= Date.parse(b.observedAt) && Date.parse(b.restorePoint) >= Date.parse(b.earliestRestoreDate), 'PITR_POINT');
  requireThat(/^[a-f0-9]{64}$/.test(b.evidenceSha256 || '') && /^[a-zA-Z0-9_-]{1,80}$/.test(b.approvalId || ''), 'BACKUP_EVIDENCE');
}
module.exports = {BASE,FORWARD,DB,HOST,RUNTIME,MIGRATOR,OWNER,EXISTING_TABLES,BASELINE_TABLES,TABLES,TYPES,FUNCTIONS,SEQUENCES,hash,requireThat,onlyKeys,ledger,backupEvidence};
