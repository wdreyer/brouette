"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp, updateDoc, doc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { reportError } from "@/lib/reportError";

type Invite = {
  id: string;
  email?: string;
  role?: string;
  token?: string;
  used?: boolean;
  memberId?: string | null;
};

type MemberOption = {
  id: string;
  label: string;
};

export default function InvitesEditor() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [token, setToken] = useState("");
  const [memberId, setMemberId] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [message, setMessage] = useState("");
  const [testInvite, setTestInvite] = useState<{ token: string; url: string } | null>(null);

  const load = async () => {
    const [snap, membersSnap] = await Promise.all([
      getDocs(query(collection(firebaseDb, "invites"), orderBy("createdAt", "desc"))),
      getDocs(collection(firebaseDb, "members")),
    ]);
    setInvites(
      snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Invite, "id">),
      })),
    );
    setMembers(
      membersSnap.docs.map((docSnap) => {
        const data = docSnap.data() as {
          firstName?: string;
          lastName?: string;
          email?: string;
        };
        const fullName = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
        const label = fullName || data.email || docSnap.id;
        return { id: docSnap.id, label };
      }),
    );
  };

  useEffect(() => {
    load().catch((error) => reportError("Echec du chargement des invitations", error));
  }, []);

  const createInvite = async () => {
    try {
      const newToken = token || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
      await addDoc(collection(firebaseDb, "invites"), {
        email: email || null,
        role,
        token: newToken,
        memberId: memberId || null,
        used: false,
        createdAt: serverTimestamp(),
      });
      setMessage("Invitation creee.");
      setToken("");
      setEmail("");
      setMemberId("");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const createTestInvite = async () => {
    try {
      const newToken = `TEST-${Date.now()}`;
      await addDoc(collection(firebaseDb, "invites"), {
        email: "test@brouette.local",
        role: "member",
        token: newToken,
        used: false,
        createdAt: serverTimestamp(),
      });
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth?invite=${newToken}`
          : `/auth?invite=${newToken}`;
      setTestInvite({ token: newToken, url });
      setMessage("Invitation test creee.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      await updateDoc(doc(firebaseDb, "invites", inviteId), { used: true });
      await load();
      setMessage("Invitation revoquee.");
    } catch (error) {
      reportError("Echec de la revocation de l'invitation", error);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">Invitations</h2>
        <p className="mt-2 text-sm text-ink/70">Créer des invitations pour s'inscrire.</p>
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/90 p-4 shadow-card">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
            Email (optionnel)
            <input
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
            Rôle
            <select
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="member">Membre</option>
              <option value="referent">Référent</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
            Token (optionnel)
            <input
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
            Membre lié (optionnel)
            <select
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">Créer un nouveau membre</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="mt-4 rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          onClick={createInvite}
        >
          Créer l'invitation
        </button>
        {message ? <p className="mt-2 text-sm text-ink/70">{message}</p> : null}
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/90 p-4 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
          Compte test
        </p>
        <p className="mt-2 text-sm text-ink/70">
          Crée une invitation pour <span className="font-semibold">test@brouette.local</span> (rôle
          adhérent).
        </p>
        <button
          className="mt-3 rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
          onClick={createTestInvite}
        >
          Créer le compte test
        </button>
        {testInvite ? (
          <div className="mt-3 text-xs text-ink/70">
            <div>Invite: {testInvite.token}</div>
            <div>URL: {testInvite.url}</div>
            <div>Mot de passe : choisis-en un (ex: test1234) lors de l'inscription.</div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/80 shadow-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-clay/70 bg-stone/80">
              <tr>
                <th className="px-4 py-3 font-semibold text-ink">Email</th>
                <th className="px-4 py-3 font-semibold text-ink">Rôle</th>
                <th className="px-4 py-3 font-semibold text-ink">Token</th>
                <th className="px-4 py-3 font-semibold text-ink">Compte</th>
                <th className="px-4 py-3 font-semibold text-ink">Statut</th>
                <th className="px-4 py-3 font-semibold text-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-b border-clay/50">
                  <td className="px-4 py-3">{invite.email ?? "-"}</td>
                  <td className="px-4 py-3">{invite.role ?? "member"}</td>
                  <td className="px-4 py-3">{invite.token ?? "-"}</td>
                  <td className="px-4 py-3">{invite.memberId ?? "-"}</td>
                  <td className="px-4 py-3">{invite.used ? "Utilisée" : "En attente"}</td>
                  <td className="px-4 py-3">
                    {!invite.used ? (
                      <button
                        className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                        onClick={() => revokeInvite(invite.id)}
                      >
                        Révoquer
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
