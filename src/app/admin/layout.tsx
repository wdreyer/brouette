import AdminGate from "@/components/auth/AdminGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGate>
      <div className="flex w-full flex-col gap-10 px-6 py-12">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-moss">Admin</p>
          <h1 className="font-serif text-4xl">Back-office coop</h1>
          <p className="max-w-2xl text-base text-ink/70">
            Gerer les collections principales. Les sous-collections (variants, offerItems, items)
            restent accessibles dans leur contexte.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="h-fit rounded-2xl border border-clay/70 bg-white/80 p-4 shadow-card">
            <nav className="flex flex-col gap-2 text-sm font-semibold">
              <a className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40" href="/admin">
                Vue d'ensemble
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/vente"
              >
                Vente
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/members"
              >
                Adherents
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/producers"
              >
                Producteurs
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/products"
              >
                Produits
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/catalogues"
              >
                Categories
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/distributionDates"
              >
                Distributions
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/orders"
              >
                Commandes
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/messages"
              >
                Messages
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/invites"
              >
                Invitations
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/documents"
              >
                Documents PDF
              </a>
              <a
                className="rounded-full border border-ink/10 px-4 py-2 transition hover:border-ink/40"
                href="/admin/settings"
              >
                Parametres
              </a>
            </nav>
          </aside>
          <section className="w-full">{children}</section>
        </div>
      </div>
    </AdminGate>
  );
}
