"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

type NavItem = {
  href: string;
  label: string;
  icon:
    | "home"
    | "sale"
    | "members"
    | "producers"
    | "products"
    | "categories"
    | "distributions"
    | "orders"
    | "stats"
    | "messages"
    | "invites"
    | "documents"
    | "settings";
  roles?: Array<"admin" | "referent">;
};

type NavGroup = {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

function Icon({ kind }: { kind: NavItem["icon"] }) {
  const base = "h-4 w-4 shrink-0";
  const props = {
    className: base,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (kind) {
    case "home":
      return (
        <svg {...props}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "sale":
      return (
        <svg {...props}>
          <path d="M5 12h14" />
          <path d="M12 5v14" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "members":
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="3.5" />
          <path d="M20 8v6" />
          <path d="M17 11h6" />
        </svg>
      );
    case "producers":
      return (
        <svg {...props}>
          <path d="M12 22c4-2.4 7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 3 8.6 7 11Z" />
          <path d="M12 8c-2 0-3 1.2-3 3s1 3 3 3 3-1.2 3-3-1-3-3-3Z" />
        </svg>
      );
    case "products":
      return (
        <svg {...props}>
          <path d="M4 7 12 3l8 4-8 4-8-4Z" />
          <path d="M4 7v10l8 4 8-4V7" />
          <path d="M12 11v10" />
        </svg>
      );
    case "categories":
      return (
        <svg {...props}>
          <path d="M4 7h7" />
          <path d="M4 12h10" />
          <path d="M4 17h13" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="20" cy="17" r="2" />
        </svg>
      );
    case "distributions":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4" />
          <path d="M8 3v4" />
          <path d="M3 11h18" />
        </svg>
      );
    case "orders":
      return (
        <svg {...props}>
          <path d="M6 4h12l-1 13H7L6 4Z" />
          <path d="M9 4V2h6v2" />
          <path d="M9 9h6" />
          <path d="M9 13h4" />
        </svg>
      );
    case "stats":
      return (
        <svg {...props}>
          <path d="M4 20V10" />
          <path d="M10 20V6" />
          <path d="M16 20v-8" />
          <path d="M22 20V4" />
        </svg>
      );
    case "messages":
      return (
        <svg {...props}>
          <path d="M4 6h16v10H8l-4 4V6Z" />
          <path d="M8 10h8" />
          <path d="M8 13h5" />
        </svg>
      );
    case "invites":
      return (
        <svg {...props}>
          <path d="M12 3v18" />
          <path d="M3 12h18" />
          <rect x="5" y="5" width="14" height="14" rx="3" />
        </svg>
      );
    case "documents":
      return (
        <svg {...props}>
          <path d="M8 3h7l4 4v14H8Z" />
          <path d="M15 3v5h5" />
          <path d="M11 13h5" />
          <path d="M11 17h5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.2a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.2a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.2a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
  }
}

const adminGroups: NavGroup[] = [
  {
    label: "Resume",
    defaultOpen: true,
    items: [
      { href: "/admin", label: "Resume", icon: "home" },
      { href: "/admin/vente", label: "Ventes", icon: "sale" },
      { href: "/admin/orders", label: "Commandes", icon: "orders" },
    ],
  },
  {
    label: "Catalogue",
    defaultOpen: true,
    items: [
      { href: "/admin/products", label: "Produits", icon: "products" },
      { href: "/admin/producers", label: "Producteurs", icon: "producers" },
      { href: "/admin/catalogues", label: "Categories", icon: "categories", roles: ["admin"] },
      { href: "/admin/calendrier-annuel", label: "Calendrier annuel", icon: "distributions", roles: ["admin"] },
      { href: "/admin/distributionDates", label: "Distributions", icon: "distributions", roles: ["admin"] },
    ],
  },
  {
    label: "Communaute",
    defaultOpen: true,
    items: [{ href: "/admin/members", label: "Adherents", icon: "members" }],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/invites", label: "Invitations", icon: "invites", roles: ["admin", "referent"] },
      { href: "/admin/messages", label: "Messages", icon: "messages", roles: ["admin", "referent"] },
      { href: "/admin/documents", label: "Documents PDF", icon: "documents", roles: ["admin", "referent"] },
      { href: "/admin/settings", label: "Parametres", icon: "settings", roles: ["admin"] },
      { href: "/admin/stats", label: "Stats", icon: "stats", roles: ["admin", "referent"] },
    ],
  },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { effectiveRole } = useAuth();

  const groups = adminGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.roles ||
          (effectiveRole === "admin" || effectiveRole === "referent"
            ? item.roles.includes(effectiveRole)
            : false),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="admin-app mx-auto flex w-full max-w-[1600px] flex-col gap-4 overflow-x-hidden px-4 py-4 md:px-6 md:py-5">
      <h1 className="px-1 font-serif text-4xl leading-none">Back-Office</h1>

      <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[10px] border border-clay/90 bg-stone p-3 shadow-sm lg:sticky lg:top-4">
          <nav className="flex flex-col gap-2">
            {groups.map((group) => (
              <div key={group.label} className="rounded-[10px] border-b border-clay/60 pb-2 last:border-b-0">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/60">
                  {group.label}
                </p>
                <div className="flex flex-col gap-1 px-2">
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
                          active
                            ? "bg-forest text-white"
                            : "text-ink/85 hover:bg-forest/20 hover:text-forest"
                        }`}
                        href={item.href}
                      >
                        <Icon kind={item.icon} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <section className="w-full min-w-0">{children}</section>
      </div>
    </div>
  );
}
