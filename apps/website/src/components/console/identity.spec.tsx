import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConsoleIdentity } from "./identity";
afterEach(cleanup);
it.each([
  ["ADMIN", "Platform Administrator"],
  ["TECHNICAL_SUPPORT", "Technical Support"],
  ["FACILITY_ADMIN", "Facility Administrator"],
  ["FACILITY_OPERATOR", "Facility Operator"],
  ["USER", "Resident"],
])("presents human identity for %s", (role, label) => {
  const v = render(
    <ConsoleIdentity name="Current Name" role={role} scope="Facility A" />,
  );
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText("Current Name")).toBeInTheDocument();
  v.rerender(
    <ConsoleIdentity name="Changed Name" role={role} scope="Facility B" />,
  );
  expect(screen.queryByText("Current Name")).not.toBeInTheDocument();
  expect(screen.queryByText("Facility A")).not.toBeInTheDocument();
  expect(screen.getByText("Changed Name")).toBeInTheDocument();
});
