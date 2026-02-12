import OpenSalesWizard from "@/components/admin/OpenSalesWizard";

export default function AdminSalePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-clay/70 bg-white/90 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
          Ouverture de la vente
        </p>
        <p className="mt-2 text-sm text-ink/70">
          Suis les etapes pour preparer puis ouvrir la prochaine distribution.
        </p>
      </div>
      <OpenSalesWizard />
    </div>
  );
}
