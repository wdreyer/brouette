"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import ProfileForm from "@/components/profile/ProfileForm";
import { findMemberByUser } from "@/lib/members";
import { reportError } from "@/lib/reportError";

function isComplete(data: Record<string, unknown>) {
  const emails = Array.isArray(data.emails)
    ? data.emails.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const phones = Array.isArray(data.phones)
    ? data.phones.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return Boolean(
    data.firstName &&
      data.lastName &&
      (emails.length > 0 || data.email) &&
      (phones.length > 0 || data.phone) &&
      data.membershipStatus,
  );
}

export default function ProfileGate({ children }: { children: React.ReactNode }) {
  const { user, memberId } = useAuth();
  const [needsProfile, setNeedsProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolvedMemberId, setResolvedMemberId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setNeedsProfile(false);
        setResolvedMemberId(null);
        setLoading(false);
        return;
      }
      const resolved = memberId
        ? { id: memberId }
        : await findMemberByUser(firebaseDb, user);
      const resolvedId = resolved?.id ?? user.uid;
      setResolvedMemberId(resolvedId);
      const snap = await getDoc(doc(firebaseDb, "members", resolvedId));
      if (!snap.exists()) {
        setNeedsProfile(true);
        setLoading(false);
        return;
      }
      setNeedsProfile(!isComplete(snap.data()));
      setLoading(false);
    };

    load().catch((error) => {
      reportError("Echec de la vérification du profil", error, { silent: true });
      setLoading(false);
    });
  }, [user, memberId]);

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
            <h2 className="mt-2 font-serif text-2xl">Complète ton profil</h2>
            <p className="mt-2 text-sm text-ink/70">
              Renseigne ces informations pour accéder au site.
            </p>
            <div className="mt-4">
              <ProfileForm
                userId={resolvedMemberId ?? user.uid}
                onSaved={() => setNeedsProfile(false)}
                canEditStatus={false}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
