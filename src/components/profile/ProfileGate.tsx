"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import ProfileForm from "@/components/profile/ProfileForm";

function isComplete(data: Record<string, unknown>) {
  return Boolean(
    data.firstName &&
      data.lastName &&
      data.email &&
      data.phone &&
      data.membershipStatus,
  );
}

export default function ProfileGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [needsProfile, setNeedsProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setNeedsProfile(false);
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(firebaseDb, "members", user.uid));
      if (!snap.exists()) {
        setNeedsProfile(true);
        setLoading(false);
        return;
      }
      setNeedsProfile(!isComplete(snap.data()));
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [user]);

  if (loading || !user) return <>{children}</>;

  return (
    <>
      {children}
      {needsProfile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-2xl rounded-2xl border border-clay/70 bg-white/95 p-6 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
              Profil requis
            </p>
            <h2 className="mt-2 font-serif text-2xl">Complete ton profil</h2>
            <p className="mt-2 text-sm text-ink/70">
              Renseigne ces informations pour acceder au site.
            </p>
            <div className="mt-4">
              <ProfileForm userId={user.uid} onSaved={() => setNeedsProfile(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
