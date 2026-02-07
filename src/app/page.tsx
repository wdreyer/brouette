import SalesStatusPanel from "@/components/SalesStatusPanel";
import CatalogueGrid from "@/components/CatalogueGrid";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <SalesStatusPanel />

      <section className="flex flex-col gap-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
            Produits de la vente
          </p>
          <h2 className="font-serif text-3xl">Catalogue</h2>
        </div>
        <CatalogueGrid />
      </section>
    </div>
  );
}
