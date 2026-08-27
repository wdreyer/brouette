"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { isLegacyPlainTextContent, renderRichTextToHtml } from "@/lib/messageFormatting";

type IconKind =
  | "h1"
  | "h2"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "link"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "hr"
  | "undo"
  | "redo";

type ToolbarButton = {
  key: IconKind;
  title: string;
  isActive: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function bridgeInitialContent(value: string) {
  if (!value.trim()) return "<p></p>";
  return isLegacyPlainTextContent(value) ? renderRichTextToHtml(value) : value;
}

function ToolbarIcon({ kind }: { kind: IconKind }) {
  const iconProps = {
    className: "h-[18px] w-[18px]",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (kind) {
    case "h1":
      return <span className="text-[13px] font-bold leading-none">H1</span>;
    case "h2":
      return <span className="text-[13px] font-bold leading-none">H2</span>;
    case "bold":
      return <span className="text-[15px] font-bold leading-none">B</span>;
    case "italic":
      return <span className="text-[15px] italic leading-none">I</span>;
    case "underline":
      return <span className="text-[15px] leading-none underline">U</span>;
    case "strike":
      return <span className="text-[15px] leading-none line-through">S</span>;
    case "link":
      return (
        <svg {...iconProps}>
          <path d="M9.5 14.5 14.5 9.5" />
          <path d="M11 6.5 12.6 4.9a3.3 3.3 0 0 1 4.7 4.7L15.7 11" />
          <path d="M13 17.5 11.4 19.1a3.3 3.3 0 0 1-4.7-4.7L8.3 13" />
        </svg>
      );
    case "bulletList":
      return (
        <svg {...iconProps}>
          <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
        </svg>
      );
    case "orderedList":
      return (
        <svg {...iconProps}>
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <text x="3" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">
            1
          </text>
          <text x="3" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">
            2
          </text>
          <text x="3" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">
            3
          </text>
        </svg>
      );
    case "blockquote":
      return (
        <svg {...iconProps}>
          <path d="M6 5v14" strokeWidth="2.5" />
          <path d="M10 8h9" />
          <path d="M10 12h9" />
          <path d="M10 16h6" />
        </svg>
      );
    case "hr":
      return (
        <svg {...iconProps}>
          <path d="M4 12h16" />
        </svg>
      );
    case "undo":
      return (
        <svg {...iconProps}>
          <path d="M8 7 4 11l4 4" />
          <path d="M4 11h10a5 5 0 0 1 0 10h-2" />
        </svg>
      );
    case "redo":
      return (
        <svg {...iconProps}>
          <path d="M16 7l4 4-4 4" />
          <path d="M20 11H10a5 5 0 0 0 0 10h2" />
        </svg>
      );
  }
}

function ToolbarButtonEl({ btn }: { btn: ToolbarButton }) {
  return (
    <button
      type="button"
      title={btn.title}
      aria-label={btn.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={btn.onClick}
      disabled={btn.disabled}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-30 ${
        btn.isActive ? "bg-forest/15 text-forest" : "text-ink/65 hover:bg-ink/8 hover:text-ink"
      }`}
    >
      <ToolbarIcon kind={btn.key} />
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-ink/12" />;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeightClass = "min-h-[240px]",
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightClass?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Écris ton message..." }),
    ],
    content: bridgeInitialContent(value),
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "rte-content focus:outline-none" },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const normalizedCurrent = current === "<p></p>" ? "" : current;
    if (value === normalizedCurrent) return;
    editor.commands.setContent(bridgeInitialContent(value), { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const previousUrl = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Adresse du lien (https://...)", previousUrl || "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const groups: ToolbarButton[][] = [
    [
      {
        key: "h1",
        title: "Titre",
        isActive: editor.isActive("heading", { level: 2 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        key: "h2",
        title: "Sous-titre",
        isActive: editor.isActive("heading", { level: 3 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      { key: "bold", title: "Gras", isActive: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
      {
        key: "italic",
        title: "Italique",
        isActive: editor.isActive("italic"),
        onClick: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        key: "underline",
        title: "Souligner",
        isActive: editor.isActive("underline"),
        onClick: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        key: "strike",
        title: "Barré",
        isActive: editor.isActive("strike"),
        onClick: () => editor.chain().focus().toggleStrike().run(),
      },
    ],
    [{ key: "link", title: "Lien", isActive: editor.isActive("link"), onClick: setLink }],
    [
      {
        key: "bulletList",
        title: "Liste à puces",
        isActive: editor.isActive("bulletList"),
        onClick: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        key: "orderedList",
        title: "Liste numérotée",
        isActive: editor.isActive("orderedList"),
        onClick: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        key: "blockquote",
        title: "Citation",
        isActive: editor.isActive("blockquote"),
        onClick: () => editor.chain().focus().toggleBlockquote().run(),
      },
    ],
    [
      {
        key: "hr",
        title: "Séparateur",
        isActive: false,
        onClick: () => editor.chain().focus().setHorizontalRule().run(),
      },
    ],
    [
      {
        key: "undo",
        title: "Annuler",
        isActive: false,
        disabled: !editor.can().undo(),
        onClick: () => editor.chain().focus().undo().run(),
      },
      {
        key: "redo",
        title: "Rétablir",
        isActive: false,
        disabled: !editor.can().redo(),
        onClick: () => editor.chain().focus().redo().run(),
      },
    ],
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-0.5 rounded-[14px] border border-ink/10 bg-stone/35 p-1.5">
        {groups.map((group, i) => (
          <div key={group[0].key} className="flex items-center gap-0.5">
            {i > 0 ? <ToolbarDivider /> : null}
            {group.map((btn) => (
              <ToolbarButtonEl key={btn.key} btn={btn} />
            ))}
          </div>
        ))}
      </div>
      <div
        className={`rte-editor cursor-text overflow-y-auto rounded-[18px] border border-ink/15 bg-white px-4 py-4 text-sm leading-7 focus-within:ring-2 focus-within:ring-forest/30 ${minHeightClass}`}
        onClick={() => editor.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
