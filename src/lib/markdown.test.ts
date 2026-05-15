import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("markdown: renderMarkdown safe subset", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Hi")).toBe("<h1>Hi</h1>");
    expect(renderMarkdown("### Sub")).toBe("<h3>Sub</h3>");
  });

  it("renders paragraphs and joins consecutive lines into one", () => {
    expect(renderMarkdown("hello\nworld\n\nagain")).toBe("<p>hello world</p>\n<p>again</p>");
  });

  it("renders unordered and ordered lists", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("escapes HTML in source content", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("renders http(s) links and strips non-http schemes", () => {
    expect(renderMarkdown("[ok](https://example.com)")).toContain('<a href="https://example.com"');
    // Non-http schemes are stripped to plain label (no <a> tag rendered).
    const out = renderMarkdown("[bad](javascript:alert)");
    expect(out).not.toContain("<a");
    expect(out).toContain("bad");
  });

  it("renders inline code and bold", () => {
    expect(renderMarkdown("use `foo` and **bar**")).toBe("<p>use <code>foo</code> and <strong>bar</strong></p>");
  });
});
