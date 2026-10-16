"use client";
import { useState } from "react";
import { ActionForm } from "./action-form";
import type { OperationStore } from "@/lib/canonical-operations";
export type GovernanceFacility = {
  id: string;
  name: string;
  organizationId: string | null;
  operationalState: string;
  type?: string;
  organization?: { id: string; name: string } | null;
  region?: string | null;
};
export type GovernanceOrganization = {
  id: string;
  name: string;
  administrators?: Array<{
    id: string;
    displayIdentity: string;
    accountStatus: string;
    isActive: boolean;
  }>;
};
export function FacilityHierarchyDetail({
  facility,
}: {
  facility: GovernanceFacility;
}) {
  return (
    <div className="ic-card">
      <h3>{facility.name}</h3>
      <p>
        Facility type:{" "}
        {facility.type?.replaceAll("_", " ") ??
          "Unavailable — refresh current state."}
      </p>
      <p>
        Parent organization:{" "}
        {facility.organizationId
          ? (facility.organization?.name ??
            "Association recorded — organization name unavailable.")
          : "Unassociated"}
      </p>
      <p>Lifecycle: {facility.operationalState}</p>
      <p>Head Office region: {facility.region ?? "Not set"}</p>
      <details>
        <summary>Record details</summary>
        <p>Facility reference: {facility.id}</p>
        <p>Organization reference: {facility.organizationId ?? "None"}</p>
      </details>
    </div>
  );
}
export function OrganizationHierarchy({
  organizations,
  facilities,
  store,
  blocked,
  onSuccess,
}: {
  organizations: GovernanceOrganization[];
  facilities: GovernanceFacility[];
  store: OperationStore;
  blocked: string;
  onSuccess: () => void;
}) {
  const [organizationId, setOrganizationId] = useState(""),
    [candidateId, setCandidateId] = useState("");
  const organization = organizations.find((o) => o.id === organizationId);
  const eligible = facilities.filter((f) => f.organizationId === null);
  const candidate = eligible.find((f) => f.id === candidateId);
  return (
    <section aria-label="Organization hierarchy">
      <h2>Organization facilities</h2>
      <p>
        Facilities remain separate authorization scopes. Choose the parent
        explicitly; matching names do not establish ownership.
      </p>
      <label>
        Open organization
        <select
          value={organization?.id ?? ""}
          onChange={(e) => {
            setOrganizationId(e.target.value);
            setCandidateId("");
          }}
        >
          <option value="">Select an organization</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {organization && (
        <>
          <h3>{organization.name}</h3>
          <p>Associated facilities in the current directory:</p>
          <ul>
            {facilities
              .filter((f) => f.organizationId === organization.id)
              .map((f) => (
                <li key={f.id}>
                  <FacilityHierarchyDetail facility={f} />
                </li>
              ))}
          </ul>
          {!facilities.some((f) => f.organizationId === organization.id) && (
            <p>No associated facilities in the current directory.</p>
          )}
          <label>
            Eligible unassociated facility
            <select
              value={candidate?.id ?? ""}
              onChange={(e) => setCandidateId(e.target.value)}
            >
              <option value="">Select an unassociated facility</option>
              {eligible.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {!eligible.length && (
            <p>No unassociated facilities in the current directory.</p>
          )}
          {candidate ? (
            <ActionForm
              key={organization.id + ":" + candidate.id}
              title="Attach facility"
              owner={organization.id + ":" + candidate.id + ":organization"}
              path={"organization/facilities/" + candidate.id + "/organization"}
              store={store}
              context={{ organizationId: organization.id }}
              prerequisite={blocked}
              confirmation
              onSuccess={onSuccess}
            >
              <p>
                Attach {candidate.name} to {organization.name}.
              </p>
              <p>
                Review both names. This establishes the initial association;
                moving an associated facility is not supported.
              </p>
              <FacilityHierarchyDetail facility={candidate} />
            </ActionForm>
          ) : (
            <p>
              Select an eligible unassociated facility to review the attachment.
            </p>
          )}
        </>
      )}
      <p>
        Current directory is bounded to 100 organizations and 100 facilities. A
        missing item is not proof that it does not exist.
      </p>
      <h3>Unassociated facilities</h3>
      <ul>
        {eligible.map((f) => (
          <li key={f.id}>{f.name} — Unassociated</li>
        ))}
      </ul>
    </section>
  );
}

/** Appoint Head Office administrators. Separate from facility attachment. */
export function HeadOfficeAdministrators({
  organizations,
  store,
  blocked,
  onSuccess,
}: {
  organizations: GovernanceOrganization[];
  store: OperationStore;
  blocked: string;
  onSuccess: () => void;
}) {
  const [organizationId, setOrganizationId] = useState("");
  const organization = organizations.find((o) => o.id === organizationId);
  return (
    <section aria-label="Head Office administrators">
      <h2>Head Office administrators</h2>
      <label>
        Organization
        <select
          value={organization?.id ?? ""}
          onChange={(e) => setOrganizationId(e.target.value)}
        >
          <option value="">Select an organization</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {organization && (
        <>
          {organization.administrators?.length ? (
            <ul>
              {organization.administrators.map((a) => (
                <li key={a.id}>
                  {a.displayIdentity} ·{" "}
                  {a.isActive ? a.accountStatus : "SUSPENDED"}
                </li>
              ))}
            </ul>
          ) : (
            <p>No Head Office administrator appointed.</p>
          )}
          <ActionForm
            key={organization.id + ":administrator"}
            title="Invite Head Office administrator"
            owner={organization.id + ":administrator"}
            path={"organization/" + organization.id + "/administrators"}
            store={store}
            prerequisite={blocked}
            confirmation
            onSuccess={onSuccess}
          >
            <p>
              The administrator sees aggregate reporting for every branch of{" "}
              {organization.name} and nothing outside it. OPA staff do not gain
              access to this dashboard.
            </p>
            <label>
              First name
              <input name="firstName" required maxLength={100} />
            </label>
            <label>
              Last name
              <input name="lastName" required maxLength={100} />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Phone in international format
              <input name="phoneNumber" type="tel" required />
            </label>
          </ActionForm>
        </>
      )}
    </section>
  );
}
