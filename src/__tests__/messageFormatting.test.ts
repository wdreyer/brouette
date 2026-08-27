import { describe, expect, it } from "vitest";
import {
  isLegacyPlainTextContent,
  renderComposedContentToEmailHtml,
  renderRichTextToHtml,
  stripHtmlToText,
} from "@/lib/messageFormatting";

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

describe("isLegacyPlainTextContent", () => {
  it("treats plain text without tags as legacy content", () => {
    expect(isLegacyPlainTextContent("Bonjour,\n\nTexte simple.")).toBe(true);
  });

  it("treats Tiptap HTML output as non-legacy content", () => {
    expect(isLegacyPlainTextContent("<p>Bonjour <strong>tous</strong></p>")).toBe(false);
  });
});

describe("renderComposedContentToEmailHtml", () => {
  it("inlines styles onto Tiptap semantic HTML for email clients", () => {
    const html = renderComposedContentToEmailHtml(
      "<h2>Titre</h2><p>Bonjour <strong>gras</strong></p><ul><li><p>Un</p></li></ul><hr>",
    );

    expect(html).toMatch(/<h2 style="[^"]*font-size:24px[^"]*">Titre<\/h2>/);
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toMatch(/<ul style="[^"]*"><li style="[^"]*">/);
    expect(html).toContain("<hr");
  });

  it("turns a blockquote into a styled callout box and sanitizes link hrefs", () => {
    const html = renderComposedContentToEmailHtml(
      '<blockquote><p>Important</p></blockquote><p><a href="javascript:alert(1)">clic</a></p>',
    );

    expect(html).not.toContain("<blockquote");
    expect(html).toContain("Important");
    expect(html).not.toContain('href="javascript:');
  });

  it("still renders legacy plain-text content the old way", () => {
    const html = renderComposedContentToEmailHtml("Bonjour,\n\n**gras**");
    expect(html).toContain("<strong>gras</strong>");
  });
});

describe("stripHtmlToText", () => {
  it("turns rendered email html back into readable plain text", () => {
    const html = renderComposedContentToEmailHtml("<h2>Titre</h2><p>Ligne <strong>un</strong></p><p>Ligne deux</p>");
    const text = stripHtmlToText(html);

    expect(text).toContain("Titre");
    expect(text).toContain("Ligne un");
    expect(text).toContain("Ligne deux");
    expect(text).not.toContain("<");
  });
});
