import SalesStatusPanel from "@/components/SalesStatusPanel";
import CatalogueGrid from "@/components/CatalogueGrid";

export default function CataloguePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
      <SalesStatusPanel />
      <section className="flex flex-col gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Catalogue</p>
          <h1 className="font-serif text-4xl">Produits de la periode</h1>
          <p className="mt-2 text-sm text-ink/70">
            Chaque produit est lie a une ou plusieurs dates de distribution.
          </p>
        </div>
        <CatalogueGrid />
      </section>
    </div>
  );
}
