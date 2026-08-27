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

const paragraphStyle = "margin:0 0 14px;line-height:1.6";
const headingLargeStyle =
  "font-family:Georgia,serif;color:#2f2a24;font-weight:700;line-height:1.25;margin:18px 0 10px;font-size:24px";
const headingSmallStyle =
  "font-family:Georgia,serif;color:#2f2a24;font-weight:700;line-height:1.25;margin:18px 0 10px;font-size:20px";
const listStyle = "margin:0 0 14px 20px;padding:0";
const listItemStyle = "margin:0 0 6px";
const quoteStyle =
  "margin:0 0 14px;padding:10px 16px;border-left:4px solid #4b7a5c;background:#f2efe4;border-radius:6px;color:#4a4438;line-height:1.5";
const dividerStyle = "border:none;border-top:1px solid #ddd1bd;margin:20px 0";

type OpenBlock = { type: "ul" | "ol" | "quote"; lines: string[] };

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

export const RICH_TEXT_SYNTAX_HELP =
  "# Titre, ## Sous-titre, **gras**, __souligné__, *italique*, ~~barré~~, [texte](lien), - liste, 1. liste numérotée, > citation, --- séparateur";
