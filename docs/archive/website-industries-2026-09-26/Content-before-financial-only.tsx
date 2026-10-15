import Link from "next/link";
import type { ReactNode } from "react";

export const pilotHref =
  "mailto:info@opasafety.com?subject=OPA%20Demo%20Inquiry";
export const trustHref =
  "mailto:security@opasafety.com?subject=OPA%20Security%20%26%20Trust%20Pack%20Request";
export const pillars = [
  ["PROTECT", "People and journeys", "/platform#protect"],
  ["COMMAND", "Incident coordination", "/command-center"],
  ["SHIELD", "Identity and operational trust", "/shield"],
  ["EVIDENCE", "Attributable history", "/platform#evidence"],
  ["INSIGHT", "Review and learning", "/platform#insight"],
] as const;

export function Section({
  id,
  label,
  title,
  children,
  tone = "",
}: {
  id?: string;
  label: string;
  title: string;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <section id={id} className={`m-section ${tone}`}>
      <div className="m-wrap">
        <p className="m-eyebrow">{label}</p>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
export function PageIntro({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="m-page-intro m-wrap">
      <p className="m-eyebrow">{label}</p>
      <h1>{title}</h1>
      <div className="m-lead">{children}</div>
    </header>
  );
}
export function Pillars() {
  return (
    <ol
      className="m-pillars"
      aria-label="Platform progression: Protect, Command, Shield, Evidence, Insight"
    >
      {pillars.map(([name, description, href]) => (
        <li key={name}>
          <Link href={href}>
            <strong>{name}</strong>
            <span>{description}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
export function PilotCTA() {
  return (
    <Section
      id="pilot"
      label="Let's talk"
      title="Bring OPA to your organization."
      tone="m-cta"
    >
      <div className="m-split">
        <p className="m-lead">
          See how OPA can strengthen emergency readiness, protect your people
          and give authorized security teams better visibility when an incident
          occurs.
        </p>

        <div className="m-actions">
          <a className="m-button" href={pilotHref}>
            Request a Demo
          </a>
          <Link className="m-button m-secondary" href="/contact">
            Contact OPA
          </Link>
        </div>
      </div>
    </Section>
  );
}
export function Safety() {
  return (
    <>
      <span id="protect" className="m-anchor" />
      <Section
        id="protection"
        label="OPA Safety"
        title="Personal safety connected to operational response."
      >
        <div className="m-split">
          <div>
            <p className="m-lead">
              Emergency SOS, Journey Protection and SafeWalk work together
              across immediate emergencies, active journeys and expected-arrival
              protection.
            </p>

            <div className="m-safety-modes">
              <article>
                <h3>Emergency SOS</h3>
                <p>
                  Activate an emergency incident with location context and
                  authorized notifications when immediate help is needed.
                </p>
              </article>

              <article>
                <h3>Journey Protection</h3>
                <p>
                  Maintain safety and location context during active journeys,
                  including recovery when connectivity is interrupted.
                </p>
              </article>

              <article>
                <h3>SafeWalk</h3>
                <p>
                  Use expected-arrival protection for personal journeys with
                  controlled guardian escalation and private-by-default
                  boundaries.
                </p>
              </article>
            </div>
          </div>
          <aside className="m-callout">
            <p className="m-eyebrow">SafeWalk / Private by default</p>
            <h3>A personal journey stays personal.</h3>
            <p>
              Personal and family journeys are isolated from institutional
              operators by default. Selected guardians receive scoped status
              access, not institutional authority.
            </p>
            <p>
              A missed arrival alone neither exposes a private journey to
              operators nor creates an emergency Incident. Institutional
              visibility requires an authorized emergency path; private
              pre-emergency movement remains excluded.
            </p>
          </aside>
        </div>
      </Section>
    </>
  );
}
export function Lifecycle() {
  const phases = [
    [
      "Before",
      "Protect",
      "Prepare people and organizations with journey protection, trusted contacts and controlled access.",
    ],
    [
      "During",
      "Respond",
      "Bring emergency alerts, location context and authorized security teams together when an incident occurs.",
    ],
    [
      "After",
      "Review",
      "Maintain a clear incident record for accountability, review and operational learning.",
    ],
  ] as const;
  return (
    <Section
      id="lifecycle"
      label="One lifecycle"
      title="Before. During. After."
    >
      <div className="m-three m-cards">
        {phases.map(([name, title, body]) => (
          <article key={name}>
            <p className="m-eyebrow">{name}</p>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
      <div className="m-pack">
        <h3>Built for coordinated response</h3>
        <p>
          OPA connects people, security teams and authorized response
          organizations through a structured emergency workflow—providing
          incident context, location intelligence and operational visibility
          when every second matters.
        </p>
      </div>
    </Section>
  );
}
export function Command({ detailed = false }: { detailed?: boolean }) {
  return (
    <Section
      id="command-center"
      label="OPA Command"
      title="A shared picture. Bounded authority."
    >
      <p className="m-lead">
        The OPA Command Center brings facility-scoped incident information,
        location context and auditable activity into a secure, role-based
        workspace for authorized teams.
      </p>
      <div
        className="m-trust-grid m-cards"
        aria-label="Institutional authority model"
      >
        {[
          [
            "Platform / Super Admin",
            "Platform-level provisioning, access control and administrative oversight.",
          ],
          [
            "Organization / Facility",
            "Controlled membership and institutional boundaries.",
          ],
          [
            "Facility Admin / Authorized Operators",
            "Facility-scoped administration and role-aware operational access.",
          ],
          [
            "Residents / Students / Employees / Members",
            "Verified membership and controlled access to OPA safety services.",
          ],
        ].map(([title, body]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
      <p>
        Role-based access helps ensure each user sees only the information and
        actions authorized for their role and facility.
      </p>
      {!detailed && (
        <Link className="m-text-link" href="/command-center">
          Explore institutional operations →
        </Link>
      )}
    </Section>
  );
}
export function Shield({ detailed = false }: { detailed?: boolean }) {
  const trustAreas = [
    {
      title: "Identity",
      body: "Protect sensitive identity while giving authorized teams the context required to respond.",
    },
    {
      title: "Authority",
      body: "Apply facility and role boundaries so operational access reflects authorized responsibilities.",
    },
    {
      title: "Accountability",
      body: "Preserve attributable actions and evidence provenance across the incident lifecycle.",
    },
    {
      title: "Third-Party Trust",
      body: "Extend identity, authorization and accountability boundaries across contractors, vendors and other authorized third parties.",
    },
  ];

  return (
    <Section
      id="shield"
      label="OPA Shield"
      title={
        detailed
          ? "Identity, authority and accountability."
          : "Identity and Operational Trust"
      }
      tone="m-tinted"
    >
      <p className="m-lead">
        OPA Shield connects protected identity, organizational context and
        authorized actions to safety operations, helping organizations maintain
        clear access and accountability boundaries.
      </p>

      <div className="m-trust-grid m-cards">
        {trustAreas.map((area) => (
          <article key={area.title}>
            <h3>{area.title}</h3>
            <p>{area.body}</p>
          </article>
        ))}
      </div>

      {detailed && (
        <div className="m-pack">
          <h3>Protected by design</h3>
          <p>
            Sensitive identifiers are masked by default in supported
            institutional workflows. Privileged resolution is restricted,
            purpose-bound and auditable.
          </p>
        </div>
      )}

      {!detailed && (
        <Link className="m-text-link" href="/shield">
          Understand OPA Shield
        </Link>
      )}
    </Section>
  );
}
export function HumanRiskIntelligence() {
  const domains = [
    {
      title: "Human Risk Intelligence",
      body: "Connect authorized safety, identity and organizational context to support informed human decision-making.",
    },
    {
      title: "Fleet & Vehicle Intelligence",
      body: "Extend journey and incident context toward fleet operations, vehicle events and mobility systems.",
    },
    {
      title: "Pipeline & Infrastructure Intelligence",
      body: "Connect field operations and incident context with authorized infrastructure and telemetry sources.",
    },
    {
      title: "Aviation Operations Intelligence",
      body: "Extend identity, workforce and incident context across safety-critical ground and aviation operations.",
    },
    {
      title: "Spatial & Drone Intelligence",
      body: "Create an integration path for authorized spatial, sensor and aerial context where operationally appropriate.",
    },
    {
      title: "Response Network Intelligence",
      body: "Connect incident context, coverage and authorized response organizations across coordinated response workflows.",
    },
  ];

  return (
    <Section
      id="human-risk-intelligence"
      label="The OPA Intelligence Layer"
      title="From human safety to operational intelligence."
      tone="m-tinted"
    >
      <p className="m-lead">
        OPA is designed to bring authorized operational signals into a common
        intelligence model while keeping human decision-makers responsible for
        interpretation and action.
      </p>

      <div className="m-pack">
        <p className="m-eyebrow">Core intelligence path</p>
        <h3>
          People + Identity + Location + Assets + Telemetry + Events
        </h3>
        <p>
          Intelligence → Command → Evidence → Insight
        </p>
      </div>

      <div className="m-three m-cards">
        {domains.map((domain) => (
          <article key={domain.title}>
            <h3>{domain.title}</h3>
            <p>{domain.body}</p>
          </article>
        ))}
      </div>

      <p className="m-note">
        Human Risk Intelligence builds on OPA's safety, identity and operational
        context. Fleet, infrastructure, aviation, spatial and response-network
        intelligence describe platform directions whose availability depends on
        supported integrations and deployment scope. OPA provides context for
        authorized human decision-makers; it does not autonomously determine
        intent or disciplinary outcomes.
      </p>
    </Section>
  );
}
export function Evidence() {
  return (
    <Section
      id="evidence"
      label="OPA Evidence"
      title="An incident should leave an attributable history."
    >
      <div className="m-split">
        <div>
          <p className="m-lead">
            Timelines, location history and supported actor/action records help
            teams understand what happened and which evidence supports the
            sequence.
          </p>
          <p>
            Tamper-evident records and integrity verification support review.
            They do not make records impossible to modify or automatically
            establish legal admissibility.
          </p>
          <p>
            Closure provenance reflects the actions and authority actually
            recorded. Supported sensitive-access audit records help explain
            privileged actions.
          </p>
        </div>
        <figure className="m-callout">
          <figcaption className="m-eyebrow">
            Delivery states
          </figcaption>
          <ul className="m-delivery">
            <li>
              Queued <span>Waiting to be processed</span>
            </li>
            <li>
              Provider accepted <span>Accepted by a delivery service</span>
            </li>
            <li>
              Confirmed delivered{" "}
              <span>Requires supporting delivery evidence</span>
            </li>
            <li>
              Failed <span>Failure recorded</span>
            </li>
          </ul>
          <p className="m-note">
            Acceptance is not delivery. Unknown or unconfirmed outcomes stay
            explicit; delivery and fixed timing are not guaranteed.
          </p>
        </figure>
      </div>
    </Section>
  );
}
export function Insight() {
  return (
    <Section
      id="insight"
      label="OPA Insight"
      title="Turn review into organizational learning."
    >
      <p className="m-lead">
        Incident history gives authorized teams a record to review together,
        supporting accountability and operational learning.
      </p>
      <p>
        Review the recorded sequence, location context and attributable actions
        to inform human decisions.
      </p>
    </Section>
  );
}
export function Connect() {
  return (
    <Section
      id="connect"
      label="OPA Connect"
      title="Connect OPA to the systems your organization already operates."
      tone="m-tinted"
    >
      <p className="m-lead">
        APIs and controlled integrations extend OPA across enterprise identity,
        operational systems and authorized telemetry sources.
      </p>

      <div className="m-three">
        <article>
          <h3>Identity & Access</h3>
          <p>
            Connect institutional identity, SSO and authorization context to
            OPA workflows.
          </p>
        </article>

        <article>
          <h3>Operational Systems</h3>
          <p>
            Bring authorized facility and enterprise-system context into
            incident and operational workflows.
          </p>
        </article>

        <article>
          <h3>Telemetry & Devices</h3>
          <p>
            Provide a controlled integration path for vehicle, infrastructure,
            sensor and other operational signals.
          </p>
        </article>
      </div>

      <p className="m-note">
        Available integrations depend on the connected system, deployment scope
        and applicable security controls.
      </p>
    </Section>
  );
}
export const industries = [
  {
    id: "financial",
    name: "Financial Services",
    intro:
      "Human risk, insider-risk context, branch safety and high-security operations.",
    body:
      "OPA brings authorized identity, incident, facility and operational context together for financial institutions managing people and sensitive environments.",
    scenario:
      "Branch operations · High-security areas · Workforce safety · Human-risk context",
    boundary:
      "OPA supports authorized human decision-making and incident operations; it does not autonomously determine employee intent or disciplinary outcomes.",
  },
  {
    id: "energy",
    name: "Energy & Critical Infrastructure",
    intro:
      "Field workforce safety, pipeline operations, remote patrol and operational telemetry direction.",
    body:
      "OPA provides a foundation for connecting workforce safety and incident operations with authorized infrastructure and telemetry sources.",
    scenario:
      "Remote workforce · Pipeline operations · Patrol coordination · Telemetry integration",
    boundary:
      "Telemetry, pipeline and sensor integrations depend on the applicable deployment and connected systems.",
  },
  {
    id: "aviation",
    name: "Aviation Operations",
    intro:
      "Ground operations, workforce safety, contractors and operational intelligence.",
    body:
      "OPA can extend its incident, identity and operational-context model to safety-critical aviation environments and distributed ground operations.",
    scenario:
      "Ground operations · Workforce · Contractors · Operational incidents",
    boundary:
      "Aviation-specific integrations and workflows are deployment directions and require operator, regulatory and technical validation.",
  },
  {
    id: "mobility",
    name: "Mobility & Fleets",
    intro:
      "Journey safety, vehicle incidents, supervised mobility and fleet intelligence.",
    body:
      "OPA's journey and incident architecture provides a foundation for mobility safety, fleet operations and future vehicle-context integrations.",
    scenario:
      "Journey safety · Fleet incidents · Vehicle context · Supervised mobility",
    boundary:
      "Vehicle telemetry and mobility-provider integrations require supported partner systems and deployment-specific controls.",
  },
  {
    id: "workforce",
    name: "Workforce & Staffing",
    intro:
      "Lone workers, deployed personnel, contractor safety and duty-of-care operations.",
    body:
      "OPA supports organizations responsible for people working late, travelling, operating remotely or serving at third-party locations.",
    scenario:
      "Lone workers · Contractors · Deployed personnel · Journey protection",
    boundary:
      "Routine movement remains private by default; institutional visibility follows defined authorization and emergency boundaries.",
  },
  {
    id: "property",
    name: "Property & Communities",
    intro:
      "Estates, facilities, residential operations and coordinated security.",
    body:
      "OPA connects authorized membership, emergency activation and facility-scoped incident operations for properties and managed communities.",
    scenario:
      "Estates · Facilities · Residents · Security operations",
    boundary:
      "Physical response remains with the authorized security or response organization.",
  },
  {
    id: "field-operations",
    name: "Field Operations",
    intro:
      "Healthcare, NGOs, distributed teams and difficult-connectivity environments.",
    body:
      "OPA supports organizations whose people operate beyond traditional facilities and need safety context, incident coordination and accountable review.",
    scenario:
      "Field teams · Healthcare travel · NGOs · Distributed operations",
    boundary:
      "Capabilities depend on connectivity, device conditions and the controls configured for the applicable deployment.",
  },
] as const;
export function Industries({ detailed = false }: { detailed?: boolean }) {
  return (
    <Section
      id="industries"
      label=""
      title="Built for safety-critical operations."
    >
      <div className="m-industry-list">
        {industries.map((industry) => (
          <article id={industry.id} key={industry.id}>

            <div>
              <h3>
                <Link href={`/industries#${industry.id}`}>
                  {industry.name}
                </Link>
              </h3>
              <p>{industry.intro}</p>
              {detailed && (
                <>
                  <p>{industry.body}</p>
                  <p className="m-eyebrow">Use case</p>
                  <p>{industry.scenario}</p>
                  <p className="m-eyebrow">Operational boundary</p>
                  <p className="m-note">{industry.boundary}</p>
                  <a
                    className="m-text-link"
                    href={`mailto:info@opasafety.com?subject=${encodeURIComponent(`OPA ${industry.name} Demo Inquiry`)}`}
                  >
                    Discuss this use case →
                  </a>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {detailed && (
        <p className="m-note">
          These operating environments describe use cases for evaluation, not
          existing customer deployments or partnerships.
        </p>
      )}
    </Section>
  );
}
export const trustTopics = [
  [
    "Tenant Isolation",
    "Organization and facility boundaries restrict institutional access across tenants.",
    "Operators hold tenant-scoped authority; platform Super Admin authority remains separate.",
  ],
  [
    "Protected Identity and Privacy by Design",
    "Sensitive identifiers are masked by default in supported institutional workflows, with privileged resolution restricted and auditable.",
    "Controls apply to supported workflows; this is not a claim of zero access or application-wide encryption.",
  ],
  [
    "Enterprise Identity",
    "OPA’s identity architecture connects institutional authentication, membership, roles and session controls.",
    "Institutional access follows membership, roles and session controls.",
  ],
  [
    "Secure Cloud Infrastructure",
    "OPA uses Microsoft Azure-hosted infrastructure with secure transport, managed identity and least-privilege access controls.",
    "Hosting architecture and deployment-specific data flows are reviewed during enterprise due diligence; hosting alone does not establish regulatory compliance.",
  ],
  [
    "Auditable Incident and Evidence Lifecycle",
    "Supported incident, access and delivery records preserve attributable operational history.",
    "Integrity verification helps make unauthorized or unexpected changes detectable while outcomes remain tied to the evidence available.",
  ],
  [
    "Controlled Software Releases",
    "Environment separation, pre-deployment validation and controlled release gates support accountable software delivery.",
    "Detailed release and security evidence is shared through qualified procurement review.",
  ],
  [
    "Business Continuity and Recovery",
    "OPA’s enterprise architecture treats backup, recovery and service continuity as explicit deployment requirements.",
    "Discuss deployment-specific recovery procedures and contractual service requirements with the OPA team.",
  ],
  [
    "Service Assurance and Support",
    "Support scope, escalation paths and service commitments are defined for the applicable institutional engagement.",
    "Availability and response-time commitments require contractual agreement. No availability percentage or response-time guarantee is implied.",
  ],
  [
    "Data Residency and Hosting",
    "Request deployment-specific hosting locations, data flows and subprocessor dependencies for enterprise review.",
    "Azure platform hosting is not a promise that all website, provider or customer data remains in one region.",
  ],
] as const;
export function Trust({ detailed = false }: { detailed?: boolean }) {
  return (
    <Section
      id="trust"
      label="Trust controls"
      title={
        detailed
          ? "Security boundaries designed for institutional review."
          : "Enterprise Trust Architecture"
      }
      tone="m-tinted"
    >
      {!detailed && <span id="resilience" className="m-anchor" />}
      <p className="m-lead">
        Useful operational context. Controlled identity access. Evidence your
        organization can review.
      </p>
      <div className="m-trust-grid">
        {(detailed ? trustTopics : trustTopics.slice(0, 6)).map(
          ([title, body, scope]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
              <p className="m-note">{scope}</p>
            </article>
          ),
        )}
      </div>
      {!detailed && (
        <Link className="m-text-link" href="/trust">
          Review security, resilience and service boundaries →
        </Link>
      )}
      <div className="m-pack">
        <h3>Security and Trust Pack</h3>
        <p>
          Qualified enterprise customers may request deeper information during
          procurement, security review or an appropriate NDA process. Scope and
          available materials are confirmed individually: architecture, access
          controls, retention, release practices, hosting and recovery may be
          discussed.
        </p>
        <a className="m-button m-secondary" href={trustHref}>
          Request Security and Trust Pack
        </a>
      </div>
      {detailed && <ConnectivityContent />}
    </Section>
  );
}
export function ConnectivityContent({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
  return (
    <div id="resilience" className={showHeading ? "m-pack" : undefined}>
      {showHeading && (
        <>
          <p className="m-eyebrow">Connectivity Resilience</p>
          <h3>
            Safety systems must remain useful when networks become unreliable.
          </h3>
        </>
      )}
      <p>
        OPA is designed for real-world connectivity conditions. Critical
        activity can be preserved locally during connectivity disruption and
        recovered when network service returns.
      </p>
      <div className="m-three m-cards">
        {[
          [
            "Continuity",
            "Designed for disruption",
            "Critical activity can be preserved locally when connectivity becomes unstable.",
          ],
          [
            "Recovery",
            "Built to recover",
            "Buffered activity can resume when connectivity returns while maintaining timing and provenance.",
          ],
          [
            "Resilient architecture",
            "Designed for changing network conditions",
            "OPA is engineered to maintain operational continuity across varying connectivity conditions.",
          ],
        ].map(([label, title, body]) => (
          <article key={label}>
            <p className="m-eyebrow">{label}</p>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
export function Connectivity() {
  return (
    <Section
      label="Connectivity Resilience"
      title="Safety systems must remain useful when networks become unreliable."
    >
      <ConnectivityContent showHeading={false} />
    </Section>
  );
}
