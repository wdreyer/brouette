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

  it("renders strikethrough, ordered lists, quotes and dividers", () => {
    const html = renderRichTextToHtml(
      "~~annule~~\n\n1. Premier\n1. Deuxieme\n\n> Une citation\n> sur deux lignes\n\n---\n\nFin",
    );

    expect(html).toContain("<s>annule</s>");
    expect(html).toMatch(/<ol[^>]*><li[^>]*>Premier<\/li><li[^>]*>Deuxieme<\/li><\/ol>/);
    expect(html).toContain("Une citation<br/>sur deux lignes");
    expect(html).toContain("<hr");
  });

  it("renders links with a safe href and keeps plain urls working without a scheme", () => {
    const withScheme = renderRichTextToHtml("[La Brouette](https://labrouette.example/retrait)");
    expect(withScheme).toContain('href="https://labrouette.example/retrait"');

    const withoutScheme = renderRichTextToHtml("[La Brouette](labrouette.example)");
    expect(withoutScheme).toContain('href="https://labrouette.example"');
  });

  it("refuses to turn a javascript: url into a usable link scheme", () => {
    const html = renderRichTextToHtml("[Clique](javascript:alert(1))");
    expect(html).not.toContain('href="javascript:');
  });
});
