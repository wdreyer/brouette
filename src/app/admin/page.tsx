import AdminDashboard from "@/components/admin/AdminDashboard";
import OpenSalesWizard from "@/components/admin/OpenSalesWizard";

export default function AdminHome() {
  return (
    <div className="flex flex-col gap-6">
      <AdminDashboard>
        <OpenSalesWizard />
      </AdminDashboard>
    </div>
  );
}
