"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { isLegacyPlainTextContent, renderRichTextToHtml } from "@/lib/messageFormatting";

type ToolbarButton = {
  key: string;
  label: string;
  isActive: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function bridgeInitialContent(value: string) {
  if (!value.trim()) return "<p></p>";
  return isLegacyPlainTextContent(value) ? renderRichTextToHtml(value) : value;
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

  const buttons: ToolbarButton[] = [
    {
      key: "h2",
      label: "Titre",
      isActive: editor.isActive("heading", { level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "h3",
      label: "Sous-titre",
      isActive: editor.isActive("heading", { level: 3 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: "bold",
      label: "Gras",
      isActive: editor.isActive("bold"),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: "Italique",
      isActive: editor.isActive("italic"),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: "underline",
      label: "Souligner",
      isActive: editor.isActive("underline"),
      onClick: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      key: "strike",
      label: "Barré",
      isActive: editor.isActive("strike"),
      onClick: () => editor.chain().focus().toggleStrike().run(),
    },
    { key: "link", label: "Lien", isActive: editor.isActive("link"), onClick: setLink },
    {
      key: "bulletList",
      label: "Liste",
      isActive: editor.isActive("bulletList"),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      label: "Liste num.",
      isActive: editor.isActive("orderedList"),
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: "blockquote",
      label: "Citation",
      isActive: editor.isActive("blockquote"),
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      key: "hr",
      label: "Séparateur",
      isActive: false,
      onClick: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-[14px] border border-ink/10 bg-stone/35 p-2">
        {buttons.map((btn) => (
          <button
            key={btn.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={btn.onClick}
            className={`rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition ${
              btn.isActive
                ? "border-forest/50 bg-forest/10 text-forest"
                : "border-ink/15 bg-white text-ink/70 hover:border-forest/35 hover:text-forest"
            }`}
          >
            {btn.label}
          </button>
        ))}
        <div className="mx-1 h-5 w-px shrink-0 bg-ink/10" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="rounded-[10px] border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-forest/35 hover:text-forest disabled:opacity-30"
        >
          Annuler
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="rounded-[10px] border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-forest/35 hover:text-forest disabled:opacity-30"
        >
          Rétablir
        </button>
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
