import type { Metadata } from "next";
import {
  PageIntro,
  PilotCTA,
  Command,
  Section,
} from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "Command Center",
  description:
    "Give authorized teams the context to act—without crossing organizational or privacy boundaries.",
};
export default function Page() {
  return (
    <>
      <PageIntro
        label="Command Center"
        title="Coordinate incidents within clear authority."
      >
        <p>
          Give authorized teams the context to act—without crossing
          organizational or privacy boundaries.
        </p>
        <p>
          Manage incident visibility, facility context, operator authority and
          response activity through a controlled institutional workspace.
        </p>
      </PageIntro>
      <Command detailed />
      <Section
        label="Institutional onboarding"
        title="Membership comes before operational access."
      >
        <div className="m-three">
          <article>
            <h3>Provision the institution</h3>
            <p>
              Super Admin provisions organizations and facilities with separate
              platform authority. Operator seats and role assignments establish
              bounded institutional access.
            </p>
          </article>
          <article>
            <h3>Invite and activate</h3>
            <p>
              Verification-first invitations, including bulk member invitations,
              connect residents, students, employees and operators to the
              appropriate facility. Pending invitations are not accepted
              membership.
            </p>
          </article>
          <article>
            <h3>Operate within scope</h3>
            <p>
              Incident queues, detail, tracking context and supported audit
              records follow current roles and facility authorization. Personal
              SafeWalk journeys do not become a routine operator feed.
            </p>
          </article>
        </div>
      </Section>
      <PilotCTA />
    </>
  );
}
