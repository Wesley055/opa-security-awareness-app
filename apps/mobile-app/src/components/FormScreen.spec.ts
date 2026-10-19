import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(join(__dirname, "../..", f), "utf8");

describe("form screens stay readable on every phone", () => {
  it.each(["app/(auth)/enroll.tsx", "app/(auth)/activate.tsx", "app/visitors.tsx"])(
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
