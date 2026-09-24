import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Safety,
  Evidence,
  Insight,
  PilotCTA,
  Trust,
  Connectivity,
  Lifecycle,
  Command,
} from "./Content";
import ShieldPage from "@/app/(site)/shield/page";

describe("public capability boundaries", () => {
  it("keeps overdue private journeys separate from institutional incidents without a release badge", () => {
    const { container } = render(<Safety />);
    expect(
      screen.getByText(/A missed arrival alone neither exposes/),
    ).toBeVisible();
    expect(
      screen.getByText(/Selected guardians receive scoped status/),
    ).toBeVisible();
    expect(container.querySelector(".m-status")).toBeNull();
    expect(container).not.toHaveTextContent(
      /generally available|operator opt-in|predictive-risk engine/i,
    );
  });
  it("retains evidence boundaries without promoting automated reporting", () => {
    const { container } = render(
      <>
        <Evidence />
        <Insight />
      </>,
    );
    expect(screen.getByText(/Acceptance is not delivery/)).toBeVisible();
    expect(
      screen.getByText(/Incident history gives authorized teams/),
    ).toBeVisible();
    expect(container).not.toHaveTextContent(
      /After-Incident Reports|AIR generation|corrective.action workflows|aggregate analytics|future direction/i,
    );
  });
  it("provides a demo email path and preserves the existing section anchor", () => {
    const { container } = render(<PilotCTA />);
    expect(
      screen.getByRole("link", { name: /Request a Demo/ }),
    ).toHaveAttribute(
      "href",
      "mailto:info@opasafety.com?subject=OPA%20Demo%20Inquiry",
    );
    expect(
      screen.getByRole("link", { name: /Contact OPA/ }),
    ).toHaveAttribute("href", "/contact");
    expect(container.querySelector("#pilot")).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container).not.toHaveTextContent(/pilot/i);
  });
  it("keeps service commitments contractual without provider or recovery guarantees", () => {
    const { container } = render(<Trust detailed />);
    expect(screen.getByText(/No availability percentage/)).toBeVisible();
    expect(screen.getByText(/not a promise that all website/)).toBeVisible();
    expect(
      screen.getByText(/Discuss deployment-specific recovery procedures/),
    ).toBeVisible();
    expect(container).not.toHaveTextContent(
      /Okta|Entra|ISO 27001|SOC 2|99.99|validated failover|RPO|RTO|acceptance remains/i,
    );
  });
  it("describes local continuity and recovery without exposing transport roadmap", () => {
    const { container } = render(<Connectivity />);
    expect(
      screen.getByRole("heading", {
        name: /Safety systems must remain useful/,
      }),
    ).toBeVisible();
    expect(container.querySelectorAll("#resilience article")).toHaveLength(3);
    expect(screen.getByText(/Buffered activity can resume/)).toBeVisible();
    expect(container).not.toHaveTextContent(
      /SMS|USSD|HTTPS|current capability|release scope|next phase|acceptance|guaranteed/i,
    );
  });
  it("limits Shield to supported foundations and retains human judgment", () => {
    const { container } = render(<ShieldPage />);
    expect(
      screen.getByText(/Human judgment remains authoritative/),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Identity" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Authority" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Accountability" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Third-Party Trust" }),
    ).toBeVisible();
    expect(container).not.toHaveTextContent(
      /IAM signals|strategic direction|future|planned|not currently deployed|expanding direction/i,
    );
  });
  it("presents three lifecycle cards without implying new workflow actions", () => {
    const { container } = render(<Lifecycle />);
    expect(container.querySelectorAll("#lifecycle article")).toHaveLength(3);
    for (const name of ["Protect", "Respond", "Review"])
      expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(container.querySelector(".m-lifecycle-stages")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Built for coordinated response" }),
    ).toBeVisible();
    expect(container).not.toHaveTextContent(
      /acknowledgement|dispatch|planned|workflow model/i,
    );
  });
  it("presents four authority cards bounded by role and facility", () => {
    const { container } = render(<Command />);
    expect(container.querySelectorAll("#command-center article")).toHaveLength(
      4,
    );
    expect(screen.getByText(/Role-based access helps ensure/)).toBeVisible();
    expect(container).not.toHaveTextContent(
      /provider acceptance|institutional acceptance|acknowledgement|close an incident/i,
    );
  });
});


