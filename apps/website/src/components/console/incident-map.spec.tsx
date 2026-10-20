import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { googleMapsUrl, IncidentMap } from "./incident-map";

it("builds a Google Maps link from valid coordinates only", () => {
  expect(googleMapsUrl(33.14825, -96.81032)).toBe("https://www.google.com/maps/search/?api=1&query=33.148250,-96.810320");
  expect(googleMapsUrl(0, 0)).toBeNull();
  expect(googleMapsUrl(91, 0)).toBeNull();
  expect(googleMapsUrl(null, 3)).toBeNull();
});

it("embeds the map and an Open in Google Maps link", () => {
  render(<IncidentMap latitude={6.4281} longitude={3.4219} />);
  expect(screen.getByTitle("Incident location map").getAttribute("src")).toContain("q=6.428100,3.421900");
  expect(screen.getByRole("link", { name: "Open in Google Maps" }).getAttribute("rel")).toContain("noopener");
});
