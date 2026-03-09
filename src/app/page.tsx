import SalesStatusPanel from "@/components/SalesStatusPanel";
import HomeCatalogueSection from "@/components/HomeCatalogueSection";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <SalesStatusPanel />

      <HomeCatalogueSection />
    </div>
  );
}
