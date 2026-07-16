import type { Metadata } from "next";
import {
  Info,
  Handshake,
  BadgeDollarSign,
  Headset,
  ShieldCheck,
  Lock,
  Newspaper,
  Scale,
  Briefcase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact OPA Technology Limited for hospital partnerships, enterprise sales, technical support, media inquiries, privacy, security, and general information.",
};

const contactOptions: {
  title: string;
  description: string;
  email: string;
  subject: string;
  icon: LucideIcon;
}[] = [
  {
    title: "General information",
    description:
      "Questions about OPA, the company, our platform, or general inquiries.",
    email: "info@opasafety.com",
    subject: "OPA General Inquiry",
    icon: Info,
  },
  {
    title: "Hospital & partnerships",
    description:
      "Hospitals, NGOs, corporate security teams, and strategic partnerships.",
    email: "partnerships@opasafety.com",
    subject: "OPA Partnership Inquiry",
    icon: Handshake,
  },
  {
    title: "Sales",
    description:
      "Product demonstrations, pricing, quotations, and enterprise subscriptions.",
    email: "sales@opasafety.com",
    subject: "OPA Sales Inquiry",
    icon: BadgeDollarSign,
  },
  {
    title: "Technical support",
    description:
      "Technical assistance, deployment questions, or product issue reporting.",
    email: "support@opasafety.com",
    subject: "OPA Technical Support",
    icon: Headset,
  },
  {
    title: "Security",
    description:
      "Responsible vulnerability disclosure and security-related inquiries.",
    email: "security@opasafety.com",
    subject: "OPA Security Inquiry",
    icon: ShieldCheck,
  },
  {
    title: "Privacy",
    description:
      "Privacy questions, personal-data requests, and deletion inquiries.",
    email: "privacy@opasafety.com",
    subject: "OPA Privacy Inquiry",
    icon: Lock,
  },
  {
    title: "Media",
    description:
      "Press inquiries, interviews, speaking engagements, and media requests.",
    email: "media@opasafety.com",
    subject: "OPA Media Inquiry",
    icon: Newspaper,
  },
  {
    title: "Legal",
    description:
      "Contracts, legal notices, compliance inquiries, and related matters.",
    email: "legal@opasafety.com",
    subject: "OPA Legal Inquiry",
    icon: Scale,
  },
  {
    title: "Careers",
    description:
      "Career opportunities and employment-related inquiries.",
    email: "careers@opasafety.com",
    subject: "OPA Career Inquiry",
    icon: Briefcase,
  },
];

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-flare">
        Contact
      </p>

      <h1 className="mt-4 font-display text-4xl font-extrabold text-ink sm:text-5xl">
        Contact the OPA team.
      </h1>

      <p className="mt-6 max-w-3xl text-muted">
        Whether you are interested in becoming a pilot partner, learning
        more about our platform, requesting a demonstration, or contacting
        a specific department, we are here to help.
      </p>

      <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {contactOptions.map((option) => (
          <div
            key={option.email}
            className="rounded-lg border border-line bg-panel p-6"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel-2">
              <option.icon size={20} className="text-signal" />
            </div>
            <h2 className="mt-4 font-display text-lg font-bold text-ink">
              {option.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              {option.description}
            </p>
            
            <a
              href={`mailto:${option.email}?subject=${encodeURIComponent(option.subject)}`}
              className="mt-5 inline-block break-all font-mono text-sm text-signal transition hover:brightness-110"
            >
              {option.email}
            </a>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-line bg-panel p-6">
        <h2 className="font-display text-base font-bold text-ink">
          Response times
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li>General inquiries: typically within 1&ndash;2 business days</li>
          <li>Partnership inquiries: typically within 1 business day</li>
          <li>Technical support: prioritized according to severity and impact</li>
        </ul>
      </div>

      <div className="mt-16 rounded-xl border border-line bg-panel p-8 sm:p-10">
        <h2 className="font-display text-2xl font-bold text-ink">
          OPA Technology Limited
        </h2>
        <p className="mt-4 max-w-3xl text-muted">
          Building trusted emergency coordination technology for
          individuals, families, and hospitals. Nigeria first, global by
          design.
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="font-display font-semibold text-ink">
              Business hours
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              Monday &ndash; Friday
              <br />
              9:00 AM &ndash; 5:00 PM (WAT)
            </p>
          </div>
          <div>
            <h3 className="font-display font-semibold text-ink">
              Website
            </h3>
            <a href="https://opasafety.com" className="mt-2 inline-block font-mono text-sm text-signal transition hover:brightness-110">
              opasafety.com
            </a>
          </div>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-xs text-muted-2">
          &copy; {new Date().getFullYear()} OPA Technology Limited. All rights reserved.
        </p>
      </div>
    </div>
  );
}