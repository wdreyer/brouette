"use client";

import { useState } from "react";
import AdminDashboard from "@/components/admin/AdminDashboard";
import OpenSalesWizard from "@/components/admin/OpenSalesWizard";

export default function AdminHome() {
  const [focusSaleWizard, setFocusSaleWizard] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <AdminDashboard focusMode={focusSaleWizard}>
        <OpenSalesWizard onFocusChange={setFocusSaleWizard} />
      </AdminDashboard>
    </div>
  );
}
