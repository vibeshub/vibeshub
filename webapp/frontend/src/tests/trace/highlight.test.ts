import { describe, expect, it } from "vitest";
import { langFromPath, highlightLine } from "../../components/trace/highlight";

describe("langFromPath", () => {
  it("maps known extensions", () => {
    expect(langFromPath("webapp/src/App.tsx")).toBe("tsx");
    expect(langFromPath("a/b/util.ts")).toBe("typescript");
    expect(langFromPath("script.py")).toBe("python");
    expect(langFromPath("deploy.sh")).toBe("bash");
    expect(langFromPath("data.json")).toBe("json");
  });
  it("returns null for unknown or missing extensions", () => {
    expect(langFromPath("Makefile")).toBeNull();
    expect(langFromPath("notes.xyz")).toBeNull();
    expect(langFromPath(null)).toBeNull();
    expect(langFromPath("")).toBeNull();
  });
});

describe("highlightLine", () => {
  it("escapes HTML when there is no language", () => {
    expect(highlightLine("<script>x</script>", null)).toBe(
      "&lt;script&gt;x&lt;/script&gt;",
    );
  });
  it("emits Prism token markup for a known language", () => {
    const html = highlightLine("const x = 1;", "javascript");
    expect(html).toContain("token");
    expect(html).toContain("keyword");
  });
  it("escapes HTML for a known language too", () => {
    const html = highlightLine("const a = '<b>';", "javascript");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b>");
  });
});
