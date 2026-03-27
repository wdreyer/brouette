import SalesStatusPanel from "@/components/SalesStatusPanel";
import ProducerAnnualCalendarPublic from "@/components/ProducerAnnualCalendarPublic";

export default function CalendarPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <SalesStatusPanel />
      <ProducerAnnualCalendarPublic />
    </div>
  );
}
