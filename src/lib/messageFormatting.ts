function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineFormatting(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

const paragraphStyle = "margin:0 0 14px;line-height:1.6";
const headingStyle = "font-family:Georgia,serif;color:#2f2a24;font-weight:700;line-height:1.25;margin:18px 0 10px";
const listStyle = "margin:0 0 14px 20px;padding:0";
const listItemStyle = "margin:0 0 6px";

export function renderRichTextToHtml(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    parts.push(
      `<ul style="${listStyle}">${listItems
        .map((item) => `<li style="${listItemStyle}">${item}</li>`)
        .join("")}</ul>`,
    );
    listItems = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushList();
      parts.push(`<h3 style="${headingStyle};font-size:20px">${renderInlineFormatting(trimmed.slice(3).trim())}</h3>`);
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushList();
      parts.push(`<h2 style="${headingStyle};font-size:24px">${renderInlineFormatting(trimmed.slice(2).trim())}</h2>`);
      return;
    }

    if (trimmed.startsWith("- ")) {
      listItems.push(renderInlineFormatting(trimmed.slice(2).trim()));
      return;
    }

    flushList();
    parts.push(`<p style="${paragraphStyle}">${renderInlineFormatting(trimmed)}</p>`);
  });

  flushList();

  return `<div class="brouette-message" style="font-family:Arial,sans-serif;color:#2f2a24;font-size:15px;line-height:1.6">${parts.join("")}</div>`;
}
