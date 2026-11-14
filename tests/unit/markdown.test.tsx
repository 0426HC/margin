import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/ui/Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} onCite={() => {}} />);

describe("chat markdown", () => {
  it("renders bold and italic, with no stars left behind", () => {
    const out = html("This is **important** and *subtle*.");
    expect(out).toContain("<strong>important</strong>");
    expect(out).toContain("<em>subtle</em>");
    expect(out).not.toContain("*");
  });

  it("renders bullets and numbered lists, and keeps line breaks", () => {
    const out = html("Intro line\nsecond line\n\n- one\n- two\n\n1. first\n2. second");
    expect(out).toContain("<br/>");
    expect(out).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(out).toContain("<ol><li>first</li><li>second</li></ol>");
  });

  it("keeps [file, p. N] citations as buttons, also inside bold", () => {
    const out = html("Faction is **the danger [a.pdf, p. 3]** here [b.pdf, p. 4].");
    expect(out.match(/class="m-cite-inline"/g)).toHaveLength(2);
    expect(out).toContain("<strong>the danger <button");
  });

  it("never turns text into HTML, and leaves an unclosed mark as it is while an answer streams", () => {
    expect(html("<script>alert(1)</script> **bold")).toContain("&lt;script&gt;");
    expect(html("<b>x</b>")).not.toContain("<b>");
    expect(html("half **bold")).toContain("half **bold");
  });

  it("turns # headings into bold lines", () => {
    expect(html("## A heading\ntext")).toContain("<strong>A heading</strong>");
  });
});
