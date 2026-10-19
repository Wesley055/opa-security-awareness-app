import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(join(__dirname, "../..", f), "utf8");

describe("form screens stay readable on every phone", () => {
  it.each(["app/(auth)/enroll.tsx", "app/(auth)/activate.tsx", "app/(auth)/register.tsx", "app/visitors.tsx"])(
    "%s uses the safe-area form layout, no fixed line heights, no centred overflow",
    (file) => {
      const src = read(file);
      expect(src).toContain("<FormScreen>");
      expect(src).not.toMatch(/lineHeight:/);
      expect(src).not.toMatch(/paddingTop: 64/);
      expect(src).not.toMatch(/justifyContent: "center",\s*\n\s*paddingHorizontal/);
    },
  );
  it("FormScreen avoids the status bar, navigation bar and keyboard", () => {
    const src = read("src/components/FormScreen.tsx");
    expect(src).toMatch(/edges=\{\["top", "bottom", "left", "right"\]\}/);
    expect(src).toContain("KeyboardAvoidingView");
    expect(src).toContain('textBreakStrategy="simple"');
  });
  it("the enroll screen asks for the short reference", () => {
    expect(read("app/(auth)/enroll.tsx")).toContain('placeholder="OPA-XXXXXX"');
  });
});
it("Create account explains what it is and points invited people to Accept invitation", () => {
  const src = read("app/(auth)/register.tsx");
  expect(src).toContain("Create a personal account");
  expect(src).toContain("Your administrator sends you an invitation");
  expect(src).not.toContain("Request enrollment");
  for (const label of ["First name", "Last name", "Email", "Phone number"]) expect(src).toContain(`>${label}</P>`);
});
it("placeholders are short enough not to be cut off on a narrow phone", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = ["app", "app/(auth)"].flatMap((d) =>
    readdirSync(join(__dirname, "../..", d)).filter((f: string) => f.endsWith(".tsx")).map((f: string) => `${d}/${f}`),
  );
  const long = files.flatMap((f) =>
    [...read(f).matchAll(/placeholder="([^"]+)"/g)].map((m) => m[1]!).filter((t) => t.length > 28 && !/guardian codes/.test(t)).map((t) => `${f}: ${t}`),
  );
  expect(long).toEqual([]);
});
