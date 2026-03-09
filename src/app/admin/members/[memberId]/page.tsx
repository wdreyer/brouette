"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";

type Producer = {
  id: string;
  name?: string;
  referentId?: string | null;
  referentName?: string | null;
  referentPhone?: string | null;
};

type Member = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  membershipStatus?: string;
  auth?: { role?: string };
};

export default function MemberPage() {
  const params = useParams();
  const memberId = String(params?.memberId ?? "");
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "referent";
  const [member, setMember] = useState<Member | null>(null);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [selectedProducerIds, setSelectedProducerIds] = useState<string[]>([]);
  const [producerSearch, setProducerSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!memberId) return;
    const load = async () => {
      const [memberSnap, producersSnap] = await Promise.all([
        getDoc(doc(firebaseDb, "members", memberId)),
        getDocs(collection(firebaseDb, "producers")),
      ]);
      if (!memberSnap.exists()) {
        setMember(null);
        return;
      }
      const data = memberSnap.data() as Member;
      setMember(data);
      const producerItems = producersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Producer, "id">),
      }));
      setProducers(producerItems);
      setSelectedProducerIds(
        producerItems.filter((producer) => producer.referentId === memberId).map((producer) => producer.id),
      );
    };
    load().catch(() => undefined);
  }, [memberId]);

  const referentName = useMemo(() => {
    if (!member) return "";
    return `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  }, [member]);

  const save = async () => {
    if (!member || !isAdmin) return;
    setMessage("");
    const batch = writeBatch(firebaseDb);

    if (member.auth?.role === "referent") {
      producers.forEach((producer) => {
        const isSelected = selectedProducerIds.includes(producer.id);
        const isCurrent = producer.referentId === memberId;
        if (isSelected || isCurrent) {
          batch.set(
            doc(firebaseDb, "producers", producer.id),
            isSelected
              ? {
                  referentId: memberId,
                  referentName: referentName || null,
                  referentPhone: member.phone ?? null,
                }
              : {
                  referentId: null,
                  referentName: null,
                  referentPhone: null,
                },
            { merge: true },
          );
        }
      });
    } else {
      producers.forEach((producer) => {
        if (producer.referentId === memberId) {
          batch.set(
            doc(firebaseDb, "producers", producer.id),
            { referentId: null, referentName: null, referentPhone: null },
            { merge: true },
          );
        }
      });
    }

    await batch.commit();
    setEditing(false);
    setMessage("Mise a jour enregistree.");
  };

  if (!member) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink/70">Adherent introuvable.</p>
        <Link className="text-sm font-semibold text-ink" href="/admin/members">
          Retour
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-clay/70 bg-white/90 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adherent</p>
            <h2 className="font-serif text-3xl">{referentName || "Fiche membre"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold" href="/admin/members">
              Retour
            </Link>
            {isAdmin ? (
              <button
                className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-stone"
                onClick={() => setEditing((prev) => !prev)}
              >
                {editing ? "Fermer" : "Editer"}
              </button>
            ) : null}
          </div>
        </div>
        {message ? <p className="mt-2 text-sm text-ink/70">{message}</p> : null}
      </div>

      <div className="border border-clay/70 bg-white/90 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Email</p>
            <p className="text-sm text-ink">{member.email ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Telephone</p>
            <p className="text-sm text-ink">{member.phone ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adhesion</p>
            <p className="text-sm text-ink">
              {member.membershipStatus === "inactive" ? "Non" : "Actif"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Role</p>
            <p className="text-sm text-ink">
              {member.auth?.role === "admin"
                ? "Admin"
                : member.auth?.role === "referent"
                  ? "Referent"
                  : "Membre"}
            </p>
          </div>
        </div>
      </div>

      {member.auth?.role === "referent" ? (
        <div className="border border-clay/70 bg-white/90 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
            Producteurs
          </p>
          {!editing ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink/70">
              {producers
                .filter((producer) => producer.referentId === memberId)
                .map((producer) => (
                  <Link
                    key={producer.id}
                    href={`/admin/producers/${producer.id}`}
                    className="rounded-full border border-ink/15 px-3 py-1"
                  >
                    {producer.name ?? "Producteur"}
                  </Link>
                ))}
              {!producers.some((producer) => producer.referentId === memberId) ? (
                <span className="text-xs text-ink/60">Aucun producteur attribue.</span>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Ajouter un producteur
                <input
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case"
                  placeholder="Rechercher..."
                  value={producerSearch}
                  onChange={(event) => setProducerSearch(event.target.value)}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedProducerIds.length ? (
                  producers
                    .filter((producer) => selectedProducerIds.includes(producer.id))
                    .map((producer) => (
                      <button
                        key={producer.id}
                        className="rounded-full border border-ink/15 px-3 py-1 text-xs text-ink/70"
                        onClick={() =>
                          setSelectedProducerIds((prev) => prev.filter((id) => id !== producer.id))
                        }
                      >
                        {producer.name ?? "Producteur"} · retirer
                      </button>
                    ))
                ) : (
                  <span className="text-xs text-ink/60">Aucun producteur attribue.</span>
                )}
              </div>
              <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-ink/10 bg-white">
                {producers
                  .filter((producer) => !selectedProducerIds.includes(producer.id))
                  .filter((producer) =>
                    producerSearch
                      ? String(producer.name ?? "").toLowerCase().includes(producerSearch.toLowerCase())
                      : true,
                  )
                  .map((producer) => (
                    <button
                      key={producer.id}
                      className="flex w-full items-center justify-between border-b border-ink/5 px-3 py-2 text-left text-xs text-ink/70 hover:bg-stone/60"
                      onClick={() =>
                        setSelectedProducerIds((prev) => [...prev, producer.id])
                      }
                    >
                      <span>{producer.name ?? "Producteur"}</span>
                      <span className="text-[11px] font-semibold text-ink/50">Ajouter</span>
                    </button>
                  ))}
                {!producers.filter((producer) => !selectedProducerIds.includes(producer.id)).length ? (
                  <p className="px-3 py-2 text-xs text-ink/50">Tout est deja attribue.</p>
                ) : null}
              </div>
            </div>
          )}
          {editing ? (
            <div className="mt-6">
              <button
                className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white"
                onClick={save}
              >
                Enregistrer
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
