function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeLinkHref(url: string) {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `https://${trimmed}`;
}

function renderInlineFormatting(value: string) {
  let html = escapeHtml(value);

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
    const href = escapeHtml(safeLinkHref(url));
    return `<a href="${href}" style="color:#3f6b4a;text-decoration:underline">${text}</a>`;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html;
}

const paragraphStyle = "margin:0 0 10px;line-height:1.6";
const headingLargeStyle =
  "font-family:Georgia,serif;color:#2f2a24;font-weight:700;line-height:1.25;margin:18px 0 10px;font-size:24px";
const headingSmallStyle =
  "font-family:Georgia,serif;color:#2f2a24;font-weight:700;line-height:1.25;margin:18px 0 10px;font-size:20px";
const listStyle = "margin:0 0 14px 20px;padding:0";
const listItemStyle = "margin:0 0 6px";
const quoteStyle =
  "margin:0 0 14px;padding:10px 16px;border-left:4px solid #4b7a5c;background:#f2efe4;border-radius:6px;color:#4a4438;line-height:1.5";
const dividerStyle = "border:none;border-top:1px solid #ddd1bd;margin:20px 0";
const linkStyle = "color:#3f6b4a;text-decoration:underline";

type OpenBlock = { type: "ul" | "ol" | "quote"; lines: string[] };

/**
 * Legacy renderer for the plain-text "## title / **bold**" syntax used before the
 * WYSIWYG editor existed. Still needed to render old saved messages/templates and
 * to bridge them into the new editor the first time they're opened.
 */
export function renderRichTextToHtml(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let openBlock: OpenBlock | null = null;

  const flushBlock = () => {
    if (!openBlock) return;
    if (openBlock.type === "ul") {
      parts.push(
        `<ul style="${listStyle}">${openBlock.lines
          .map((item) => `<li style="${listItemStyle}">${renderInlineFormatting(item)}</li>`)
          .join("")}</ul>`,
      );
    } else if (openBlock.type === "ol") {
      parts.push(
        `<ol style="${listStyle}">${openBlock.lines
          .map((item) => `<li style="${listItemStyle}">${renderInlineFormatting(item)}</li>`)
          .join("")}</ol>`,
      );
    } else {
      parts.push(
        `<div style="${quoteStyle}">${openBlock.lines.map((item) => renderInlineFormatting(item)).join("<br/>")}</div>`,
      );
    }
    openBlock = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushBlock();
      return;
    }

    if (trimmed === "---") {
      flushBlock();
      parts.push(`<hr style="${dividerStyle}" />`);
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushBlock();
      parts.push(`<h3 style="${headingSmallStyle}">${renderInlineFormatting(trimmed.slice(3).trim())}</h3>`);
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushBlock();
      parts.push(`<h2 style="${headingLargeStyle}">${renderInlineFormatting(trimmed.slice(2).trim())}</h2>`);
      return;
    }

    if (trimmed.startsWith("> ")) {
      const text = trimmed.slice(2).trim();
      if (openBlock?.type === "quote") openBlock.lines.push(text);
      else {
        flushBlock();
        openBlock = { type: "quote", lines: [text] };
      }
      return;
    }

    if (trimmed.startsWith("- ")) {
      const text = trimmed.slice(2).trim();
      if (openBlock?.type === "ul") openBlock.lines.push(text);
      else {
        flushBlock();
        openBlock = { type: "ul", lines: [text] };
      }
      return;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const text = orderedMatch[1].trim();
      if (openBlock?.type === "ol") openBlock.lines.push(text);
      else {
        flushBlock();
        openBlock = { type: "ol", lines: [text] };
      }
      return;
    }

    flushBlock();
    parts.push(`<p style="${paragraphStyle}">${renderInlineFormatting(trimmed)}</p>`);
  });

  flushBlock();

  return `<div class="brouette-message" style="font-family:Arial,sans-serif;color:#2f2a24;font-size:15px;line-height:1.6">${parts.join("")}</div>`;
}

/**
 * The WYSIWYG editor (Tiptap) hands back clean semantic HTML: <p>, <h2>/<h3>,
 * <strong>/<em>/<u>/<s>, <ul>/<ol>/<li>, <blockquote>, <hr>, <a href>. Email clients
 * (Outlook in particular) ignore stylesheets, so every tag needs its style inlined
 * by hand here rather than relying on the .brouette-message CSS class.
 */
function applyEmailInlineStyles(html: string) {
  let out = html;

  out = out
    .replace(/<h2(?:\s[^>]*)?>/gi, `<h2 style="${headingLargeStyle}">`)
    .replace(/<h3(?:\s[^>]*)?>/gi, `<h3 style="${headingSmallStyle}">`)
    .replace(/<p(?:\s[^>]*)?>/gi, `<p style="${paragraphStyle}">`)
    .replace(/<ul(?:\s[^>]*)?>/gi, `<ul style="${listStyle}">`)
    .replace(/<ol(?:\s[^>]*)?>/gi, `<ol style="${listStyle}">`)
    .replace(/<li(?:\s[^>]*)?>/gi, `<li style="${listItemStyle}">`)
    .replace(/<hr(?:\s[^>]*)?\/?>/gi, `<hr style="${dividerStyle}" />`)
    .replace(/<blockquote(?:\s[^>]*)?>/gi, `<div style="${quoteStyle}">`)
    .replace(/<\/blockquote>/gi, "</div>");

  out = out.replace(/<a\s+[^>]*?href="([^"]*)"[^>]*>/gi, (_match, href: string) => {
    const safeHref = escapeHtml(safeLinkHref(href));
    return `<a href="${safeHref}" style="${linkStyle}">`;
  });

  return out;
}

/**
 * Single entry point used both for the live preview and at send time. Detects
 * whether the stored content is the new Tiptap HTML or an older plain-text
 * message and renders either into the same inline-styled email markup.
 */
export function renderComposedContentToEmailHtml(content: string) {
  const inner = isLegacyPlainTextContent(content)
    ? renderRichTextToHtml(content).replace(/^<div class="brouette-message"[^>]*>|<\/div>$/g, "")
    : applyEmailInlineStyles(content);

  return `<div class="brouette-message" style="font-family:Arial,sans-serif;color:#2f2a24;font-size:15px;line-height:1.6">${inner}</div>`;
}

/** Best-effort plain-text fallback derived from the final rendered email HTML. */
export function stripHtmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<hr[^>]*>/gi, "\n---\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the stored content is legacy plain-text (no HTML tags), used to bridge it into the WYSIWYG editor. */
export function isLegacyPlainTextContent(content: string) {
  return !/<[a-z][\s\S]*>/i.test(content);
}
