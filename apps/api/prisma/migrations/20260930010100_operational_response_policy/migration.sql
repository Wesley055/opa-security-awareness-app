BEGIN;
-- CreateTable
CREATE TABLE "FacilityResponsePolicy" (
    "facilityId" UUID NOT NULL,
    "acknowledgementSeconds" INTEGER NOT NULL,
    "dispatchSeconds" INTEGER NOT NULL,
    "progressSeconds" INTEGER NOT NULL,
    "unattendedSeconds" INTEGER NOT NULL,
    "closureSeconds" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityResponsePolicy_pkey" PRIMARY KEY ("facilityId")
);

-- AddForeignKey
ALTER TABLE "FacilityResponsePolicy" ADD CONSTRAINT "FacilityResponsePolicy_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityResponsePolicy" ADD CONSTRAINT "FacilityResponsePolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "FacilityResponsePolicy" ADD CONSTRAINT response_policy_bounds CHECK (
 "acknowledgementSeconds" BETWEEN 1 AND 604800 AND "dispatchSeconds" BETWEEN 1 AND 604800 AND "progressSeconds" BETWEEN 1 AND 604800 AND "unattendedSeconds" BETWEEN "acknowledgementSeconds" AND 604800 AND "closureSeconds" BETWEEN "unattendedSeconds" AND 604800 AND version>0);
CREATE UNIQUE INDEX operational_exception_once ON "IncidentTimelineEvent"("incidentId", (payload->>'kind')) WHERE type='OPERATIONAL_EXCEPTION';
-- Compatibility writers cannot reactivate decommissioned facilities or claim readiness.
CREATE FUNCTION synchronize_facility_operational_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."operationalState"='DECOMMISSIONED' AND (NEW."isActive" OR NEW."operationalState"<>'DECOMMISSIONED') THEN
  RAISE EXCEPTION 'DECOMMISSIONED_FACILITY_REQUIRES_REVIEW' USING ERRCODE='23514';
 END IF;
 IF NOT NEW."isActive" AND NEW."operationalState"<>'DECOMMISSIONED' THEN NEW."operationalState"='SUSPENDED'; END IF;
 IF TG_OP='UPDATE' AND NEW."isActive" AND NOT OLD."isActive" AND NEW."operationalState"=OLD."operationalState" THEN NEW."operationalState"='COMMISSIONING'; END IF;
 IF NEW."operationalState" IN ('SUSPENDED','DECOMMISSIONED') THEN NEW."isActive"=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER synchronize_facility_operational_state BEFORE INSERT OR UPDATE ON "Facility" FOR EACH ROW EXECUTE FUNCTION synchronize_facility_operational_state();
COMMIT;
