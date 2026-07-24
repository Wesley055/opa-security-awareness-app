import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";

export const metadata: Metadata = {
  title: "Careers | OPA",
  description:
    "Join the team building emergency safety software for Nigeria. Open roles at OPA Technologies Limited.",
};

const responsibilities = [
  "Build strategic partnerships with hospitals, security companies, universities, residential estates, employers, NGOs, telecommunications companies and public institutions",
  "Identify and secure pilot programmes that validate OPA in real environments",
  "Research how organisations evaluate and procure safety technology, including who decides and how long it takes",
  "Meet decision-makers and understand their operational challenges",
  "Represent OPA at conferences, networking events and industry meetings",
  "Help develop pricing, partnership models and go-to-market strategy",
  "Gather customer feedback and turn it into product insight",
  "Support fundraising efforts, grant applications and strategic partnerships",
  "Identify new markets and commercial opportunities across Nigeria",
];

const requirements = [
  "Three to seven years in business development, strategic partnerships, enterprise sales or institutional sales",
  "Experience selling to or partnering with B2B organisations in Nigeria",
  "Strong relationship-building and negotiation skills",
  "Excellent written and verbal communication",
  "Confidence presenting to executives and senior decision-makers",
  "The ability to work independently at an early stage, without a playbook",
];

const technical = [
  "Mobile applications",
  "Cloud platforms such as Azure, AWS or Google Cloud",
  "APIs and software integrations",
  "GPS, mapping and location services",
  "AI and machine learning concepts, and their limits",
  "Identity, authentication and security fundamentals",
  "Data protection and privacy",
  "SaaS and subscription business models",
];

const niceToHave = [
  "Emergency management or public safety",
  "Healthcare",
  "Telecommunications",
  "Security services",
  "Insurance",
  "Enterprise SaaS",
  "Government partnerships",
  "Previous startup or founding-team experience",
];

const firstNinetyDays = [
  "Built relationships with twenty-five to forty target organisations",
  "Established a qualified pipeline of pilot opportunities",
  "Produced OPA's first partnership strategy",
  "Delivered market feedback that changes a product decision",
  "Validated pricing assumptions against real conversations",
  "Identified grant and funding opportunities worth pursuing",
];

const thrives = [
  "You like problems without obvious answers",
  "You can hold a conversation with an engineer and with a hospital director, and adjust",
  "You would rather build a process than follow one",
  "You are comfortable deciding with incomplete information",
  "You care about technology that has real social consequences",
];

const doesNotThrive = [
  "You prefer a large organisation with clear structure and defined lanes",
  "You want thorough onboarding before taking ownership of anything",
  "You expect a mature product and an established sales process",
];

const whyJoin = [
  "Work directly with the founder on everything commercial",
  "Influence product strategy from real market feedback",
  "Shape how OPA enters the market, from zero",
  "Build something with genuine social impact",
  "Grow with the company as it expands",
];

const process = [
  "Submit your application",
  "Introductory conversation with the founder",
  "A practical business discussion using a real OPA scenario",
  "Reference conversations",
  "Final interview and offer",
];

const values = [
  {
    title: "Honesty about what we've built",
    body: "We describe the product as it is, not as we intend it to become. That applies to our marketing, our partnership conversations and our job descriptions.",
  },
  {
    title: "The failure mode matters more than the feature",
    body: "In a safety product the question is never only whether something works. It is what happens when it doesn't. We design for the bad day.",
  },
  {
    title: "Nigeria first, properly",
    body: "Not a foreign product translated. Built for patchy connectivity, DND-registered numbers, low-end devices and how people here actually behave in an emergency.",
  },
  {
    title: "Small team, real ownership",
    body: "Everyone here decides things that matter. If you need a defined lane and a long ramp, this is the wrong stage.",
  },
];

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm text-muted">
          <span
            aria-hidden="true"
            className="mt-2 h-1 w-1 shrink-0 rounded-full bg-protection"
          />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
      {children}
    </h4>
  );
}

export default function CareersPage() {
  return (
    <main className="py-16 sm:py-24">
      <Container>
        <div className="max-w-3xl">
          <p className="font-display text-sm font-semibold uppercase tracking-wider text-protection">
            Careers
          </p>
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Build the thing that gets help to people faster
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            Personal safety in Nigeria is a real, daily problem, and the tools
            available have not kept up. OPA is a small team building the
            software layer for emergency response, starting with getting the
            right people alerted, fast, when someone is in danger.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            The work is early. What exists today works and is in use. Most of
            what OPA will be is still ahead. If you want a defined role in a
            mature company, this is not that. If you want your decisions to
            shape what the company becomes, it is.
          </p>
        </div>

        {/* Values */}
        <section className="mt-20">
          <h2 className="font-display text-2xl font-bold text-ink">
            How we work
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {values.map((value) => (
              <div
                key={value.title}
                className="rounded-lg border border-line p-6"
              >
                <h3 className="font-display text-base font-bold text-ink">
                  {value.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {value.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Open role */}
        <section className="mt-20">
          <h2 className="font-display text-2xl font-bold text-ink">
            Open roles
          </h2>

          <article className="mt-8 rounded-lg border border-line p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-xl font-bold text-ink">
                  Business Development Lead
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Founding team &middot; Lagos, Nigeria (Hybrid) &middot; Full-time
                </p>
              </div>
              <span className="rounded-full bg-protection/10 px-3 py-1 text-xs font-semibold text-protection">
                Now hiring
              </span>
            </div>

            <p className="mt-6 leading-relaxed text-muted">
              We are looking for our first Business Development Lead: someone
              who can help turn a working product into trusted partnerships
              across Nigeria.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              This is not a traditional sales role. You will not inherit a
              mature product, an established customer base or a polished
              playbook. You will work directly with the founder to shape how
              OPA enters the market, builds credibility and launches with the
              right partners.
            </p>

            <p className="mt-6 rounded-md bg-protection/5 p-5 text-sm font-semibold leading-relaxed text-ink">
              We are looking for someone excited to build, not just sell.
              Success here comes from creating trusted partnerships,
              understanding what customers actually need, and helping shape
              where OPA goes next. Not from hitting a quarterly quota.
            </p>

            {/* Honest state of the product */}
            <div className="mt-8 rounded-md border-l-2 border-emergency bg-emergency/5 p-5">
              <p className="text-sm font-semibold text-ink">
                Where OPA actually is today
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                OPA&rsquo;s emergency alerting works: a user triggers an alert
                and the trusted contacts they have registered are notified with
                their live location. That part is built, tested and running.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                What comes next is a live incident view for families, then
                continuous location tracking. The institutional products, a
                monitoring dashboard for organisations and journey safety
                monitoring for lone workers, are planned but not yet built.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                So your first months are not about aggressively selling
                unfinished software. They are about learning the market,
                building trust, testing assumptions and preparing partnerships
                that are ready when the commercial products land. We would
                rather build long-term trust than promise features that
                aren&rsquo;t ready. If that sounds like the wrong kind of
                ambiguity, this is not the right role.
              </p>
            </div>

            <div className="mt-8">
              <SectionHeading>What you&rsquo;ll do</SectionHeading>
              <Bullets items={responsibilities} />
            </div>

            <div className="mt-8">
              <SectionHeading>What we&rsquo;re looking for</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                We care more about curiosity, integrity and execution than
                perfect credentials.
              </p>
              <Bullets items={requirements} />
            </div>

            <div className="mt-8">
              <SectionHeading>Where the technology is going</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                OPA is a technology company and intends to stay one. Today the
                platform runs on mobile, cloud infrastructure and location
                services. Where we are heading involves applying machine
                learning to emergency response: understanding context from
                signals a person in danger cannot report themselves, and
                helping the right people act on it faster.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                None of that is built yet, and we are deliberate about which of
                it belongs in a safety product at all. A system that ranks one
                person&rsquo;s emergency below another&rsquo;s has to be right.
                That care is part of the work, and part of what you would be
                explaining to partners.
              </p>
            </div>

            <div className="mt-8">
              <SectionHeading>Technical understanding</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                You do not need to be an engineer, but you should be
                comfortable discussing technology with customers, partners and
                investors, and know when to bring engineering into the
                conversation. Familiarity with any of these helps:
              </p>
              <Bullets items={technical} />
            </div>

            <div className="mt-8">
              <SectionHeading>Nice to have</SectionHeading>
              <Bullets items={niceToHave} />
            </div>

            <div className="mt-8">
              <SectionHeading>Your first ninety days</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Success will not be measured by immediate sales. By the end of
                your first ninety days we would expect you to have:
              </p>
              <Bullets items={firstNinetyDays} />
            </div>

            <div className="mt-8">
              <SectionHeading>Why join</SectionHeading>
              <Bullets items={whyJoin} />
            </div>

            <div className="mt-8">
              <SectionHeading>Who thrives here</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                This role suits you if:
              </p>
              <Bullets items={thrives} />
              <p className="mt-5 text-sm leading-relaxed text-muted">
                It probably does not suit you if:
              </p>
              <Bullets items={doesNotThrive} />
              <p className="mt-5 text-sm leading-relaxed text-muted">
                We would rather say this plainly than waste your time or ours.
              </p>
            </div>

            <div className="mt-8">
              <SectionHeading>Travel and compensation</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                The role involves regular travel within Nigeria to meet
                partners, attend industry events and support pilot
                opportunities.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                We will discuss compensation openly in our first conversation,
                including what we can offer today and how that changes as OPA
                grows. Ask early. We would rather have that conversation at the
                start than at the end.
              </p>
            </div>

            <p className="mt-8 rounded-md bg-protection/5 p-5 text-sm font-semibold leading-relaxed text-ink">
              We are not looking for someone to sell a finished company. We are
              looking for someone to help build one.
            </p>

            <div className="mt-8 border-t border-line pt-8">
              <SectionHeading>How to apply</SectionHeading>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Send your CV and a short note covering why OPA interests you,
                what excites you about this role, and what you would focus on
                in your first ninety days. We read every application and reply
                to all of them.
              </p>
              <a
                href="mailto:careers@opasafety.com?subject=Business%20Development%20Lead%20application"
                className="mt-5 inline-flex rounded-md bg-emergency px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection focus-visible:ring-offset-2 focus-visible:ring-offset-base"
              >
                Apply for this role
              </a>
            </div>
          </article>
        </section>

        {/* Hiring process */}
        <section className="mt-20 max-w-3xl">
          <h2 className="font-display text-2xl font-bold text-ink">
            How we hire
          </h2>
          <ol className="mt-6 space-y-4">
            {process.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line font-display text-xs font-bold text-protection">
                  {index + 1}
                </span>
                <span className="pt-0.5 leading-relaxed text-muted">
                  {step}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm leading-relaxed text-muted">
            We aim to respond within one week at every stage, and to tell you
            if the answer is no.
          </p>
        </section>

        {/* Equal opportunity */}
        <section className="mt-20 max-w-3xl border-t border-line pt-10">
          <h2 className="font-display text-lg font-bold text-ink">
            Equal opportunity
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            OPA hires on ability, integrity and alignment with our mission. We
            welcome applicants from all backgrounds and do not discriminate on
            the basis of gender, ethnicity, religion, disability, age, marital
            status or state of origin. If you need any adjustment to take part
            in our hiring process, tell us and we will arrange it.
          </p>
        </section>

        {/* Nothing suitable */}
        <section className="mt-16 max-w-3xl">
          <p className="text-sm leading-relaxed text-muted">
            Nothing here that fits? If you think you should be working on this,
            write to{" "}
            <a
              href="mailto:careers@opasafety.com"
              className="font-semibold text-protection underline underline-offset-4 hover:brightness-110"
            >
              careers@opasafety.com
            </a>{" "}
            and tell us why. Or{" "}
            <Link
              href="/about"
              className="font-semibold text-protection underline underline-offset-4 hover:brightness-110"
            >
              read more about OPA
            </Link>{" "}
            first.
          </p>
        </section>
      </Container>
    </main>
  );
}
