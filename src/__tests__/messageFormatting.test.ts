import { describe, expect, it } from "vitest";
import { renderRichTextToHtml } from "@/lib/messageFormatting";

describe("renderRichTextToHtml", () => {
  it("renders basic rich text markup safely", () => {
    const html = renderRichTextToHtml("# Titre\nBonjour **gras** et __souligne__\n- Un\n- Deux");

    expect(html).toMatch(/<h2[^>]*>Titre<\/h2>/);
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<u>souligne</u>");
    expect(html).toMatch(/<ul[^>]*><li[^>]*>Un<\/li><li[^>]*>Deux<\/li><\/ul>/);
    // Inline styles are required so the markup renders correctly in email clients that strip <style> blocks.
    expect(html).toContain('style="');
  });

  it("escapes raw html before applying formatting", () => {
    const html = renderRichTextToHtml("<script>alert(1)</script> **ok**");

    expect(html).toContain("&lt;script&gt;alert(1)");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>ok</strong>");
  });
});
