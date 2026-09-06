"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { readBalanceTrackingEnabled } from "@/lib/balanceTracking";
import { DEFAULT_MEMBER_PASSWORD } from "@/lib/memberAuthSync";

type FieldType = "text" | "number" | "boolean" | "date" | "datetime";

type FieldConfig = {
  label: string;
  path: string;
  type: FieldType;
  table?: boolean;
};

type EditorProps = {
  collectionName: string;
  title: string;
  description?: string;
  fields: FieldConfig[];
  viewMode?: "all" | "adherents" | "coopMembers";
};

type DocEntry = {
  id: string;
  data: Record<string, unknown>;
};

type Producer = {
  id: string;
  name?: string;
  referentId?: string | null;
  referentName?: string | null;
  referentPhone?: string | null;
};

type LedgerEntry = {
  id: string;
  type?: string;
  amount?: number;
  label?: string;
  note?: string;
  orderId?: string;
  occurredAt?: Timestamp;
  createdAt?: Timestamp;
};

function getByPath(obj: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
}

function toInputValue(value: unknown, type: FieldType) {
  if (type === "boolean") return Boolean(value);
  if (type === "number") return value === undefined || value === null ? "" : String(value);
  if (value instanceof Timestamp) {
    const date = value.toDate();
    return type === "date"
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 16);
  }
  if (value instanceof Date) {
    return type === "date" ? value.toISOString().slice(0, 10) : value.toISOString().slice(0, 16);
  }
  return value === undefined || value === null ? "" : String(value);
}

function fromInputValue(value: string, type: FieldType) {
  if (type === "number") return value === "" ? null : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "date" && value) return Timestamp.fromDate(new Date(`${value}T00:00:00`));
  if (type === "datetime" && value) return Timestamp.fromDate(new Date(value));
  return value;
}

function displayValue(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function toList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function uniqueList(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function formatMembershipStatus(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "active" || normalized === "adherent") return "Actif";
  if (normalized === "inactive" || normalized === "non-adherent" || normalized === "non") return "Inactif";
  return displayValue(value);
}

function formatMembershipPaymentStatus(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (["up_to_date", "a_jour", "a-jour", "paid", "ok"].includes(normalized)) return "Payé";
  if (["to_pay", "a_payer", "a-payer", "unpaid", "due"].includes(normalized)) return "Non payé";
  return displayValue(value);
}

function formatDateValue(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toLocaleDateString("fr-FR");
  if (value instanceof Date) return value.toLocaleDateString("fr-FR");
  return displayValue(value);
}

function formatRole(value: unknown) {
  if (value === "admin") return "Admin";
  if (value === "referent") return "Référent";
  if (value === "member") return "Membre";
  return displayValue(value);
}

function entryDate(entry: LedgerEntry) {
  return entry.occurredAt?.toDate() ?? entry.createdAt?.toDate() ?? new Date(0);
}

function formatMoney(value: number) {
  return Number(value || 0).toFixed(2).replace(".", ",");
}

export default function MembersEditor({
  collectionName,
  title,
  description,
  fields,
  viewMode = "all",
}: EditorProps) {
  const { role, memberId, user } = useAuth();
  const canEditMembers = role === "admin" || role === "referent";
  const isAdmin = role === "admin";
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [viewingEntry, setViewingEntry] = useState<DocEntry | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [editEmails, setEditEmails] = useState<string[]>([""]);
  const [editPhones, setEditPhones] = useState<string[]>([""]);
  const [editPassword, setEditPassword] = useState("");
  const [lastSetPassword, setLastSetPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [filter, setFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [deletingMember, setDeletingMember] = useState(false);
  const [balanceTrackingEnabled, setBalanceTrackingEnabled] = useState(true);
  const [balanceByMemberId, setBalanceByMemberId] = useState<Record<string, number>>({});
  const [ledgerByMemberId, setLedgerByMemberId] = useState<Record<string, LedgerEntry[]>>({});
  const [ledgerLoadingMemberId, setLedgerLoadingMemberId] = useState<string | null>(null);
  const [ledgerSaving, setLedgerSaving] = useState(false);
  const [ledgerDirection, setLedgerDirection] = useState<"credit" | "debit">("credit");
  const [ledgerAmount, setLedgerAmount] = useState("0");
  const [ledgerLabel, setLedgerLabel] = useState("Ajustement manuel");
  const [ledgerNote, setLedgerNote] = useState("");

  const tableFields = useMemo(() => fields.filter((field) => field.table), [fields]);
  const showAssignedProducersColumn = viewMode !== "adherents";
  const formFields = useMemo(
    () =>
      fields.filter(
        (field) => !["email", "phone", "accountLabel", "sharedAccountEnabled", "secondaryEmail", "secondaryPhone"].includes(field.path),
      ),
    [fields],
  );

  const extractEmails = (data: Record<string, unknown>) => {
    const values = uniqueList([
      ...toList(data.emails),
      String(data.email ?? ""),
    ]);
    return values.length ? values : [""];
  };

  const extractPhones = (data: Record<string, unknown>) => {
    const values = uniqueList([
      ...toList(data.phones),
      String(data.phone ?? ""),
    ]);
    return values.length ? values : [""];
  };

  const authHeaders = async () => {
    if (!user) throw new Error("Session admin invalide.");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    };
  };

  const syncMemberAuth = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/members/auth-sync", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      createdAuthUser?: boolean;
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Synchronisation du compte de connexion impossible.");
    }
    return result;
  };

  const loadBalances = async (entries: DocEntry[]) => {
    const sums = await Promise.all(
      entries.map(async (entry) => {
        try {
          const ledgerSnap = await getDocs(collection(firebaseDb, "members", entry.id, "ledger"));
          const total = ledgerSnap.docs.reduce(
            (sum, docSnap) => sum + Number(docSnap.get("amount") ?? 0),
            0,
          );
          return [entry.id, total] as const;
        } catch {
          return [entry.id, 0] as const;
        }
      }),
    );
    setBalanceByMemberId(Object.fromEntries(sums));
  };

  const load = async () => {
    setLoading(true);
    const [membersSnap, producersSnap, nextBalanceTrackingEnabled] = await Promise.all([
      getDocs(collection(firebaseDb, collectionName)),
      getDocs(collection(firebaseDb, "producers")),
      readBalanceTrackingEnabled(firebaseDb),
    ]);
    const items = membersSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as Record<string, unknown>,
    }));
    const producerItems = producersSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Producer, "id">),
    }));
    setDocs(items);
    setProducers(producerItems);
    setBalanceTrackingEnabled(nextBalanceTrackingEnabled);
    if (nextBalanceTrackingEnabled) {
      await loadBalances(items);
    } else {
      setBalanceByMemberId({});
    }
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [collectionName]);

  useEffect(() => {
    if (viewMode === "adherents") {
      setFilterRole("member");
      return;
    }
    if (viewMode === "coopMembers" && filterRole === "member") {
      setFilterRole("all");
    }
  }, [viewMode, filterRole]);

  const roleFilterOptions = useMemo(() => {
    if (viewMode === "adherents") {
      return [{ value: "member", label: "Membre" }];
    }
    if (viewMode === "coopMembers") {
      return [
        { value: "all", label: "Admins + Référents" },
        { value: "referent", label: "Référent" },
        { value: "admin", label: "Admin" },
      ];
    }
    return [
      { value: "all", label: "Tous les rôles" },
      { value: "member", label: "Membre" },
      { value: "referent", label: "Référent" },
      { value: "admin", label: "Admin" },
    ];
  }, [viewMode]);

  const loadMemberLedger = async (memberId: string) => {
    try {
      setLedgerLoadingMemberId(memberId);
      const ledgerSnap = await getDocs(
        query(collection(firebaseDb, collectionName, memberId, "ledger"), limit(300)),
      );
      const items = ledgerSnap.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<LedgerEntry, "id">),
        }))
        .sort((a, b) => entryDate(b).getTime() - entryDate(a).getTime());
      setLedgerByMemberId((prev) => ({ ...prev, [memberId]: items }));
      const total = items.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
      setBalanceByMemberId((prev) => ({ ...prev, [memberId]: total }));
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
      setLedgerByMemberId((prev) => ({ ...prev, [memberId]: [] }));
      setBalanceByMemberId((prev) => ({ ...prev, [memberId]: 0 }));
    } finally {
      setLedgerLoadingMemberId((prev) => (prev === memberId ? null : prev));
    }
  };

  const openView = (entry: DocEntry) => {
    setViewingEntry(entry);
    setMessage("");
    setLedgerDirection("credit");
    setLedgerAmount("0");
    setLedgerLabel("Ajustement manuel");
    setLedgerNote("");
    if (balanceTrackingEnabled) {
      loadMemberLedger(entry.id).catch(() => undefined);
    } else {
      setLedgerByMemberId((prev) => ({ ...prev, [entry.id]: [] }));
    }
  };

  const submitLedgerOperation = async () => {
    if (!balanceTrackingEnabled) return;
    if (!isAdmin || !viewingEntry) return;
    const rawAmount = Number(String(ledgerAmount).replace(",", "."));
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      setMessage("Montant invalide.");
      return;
    }
    const signedAmount = ledgerDirection === "credit" ? rawAmount : -rawAmount;
    const cleanedLabel = ledgerLabel.trim() || "Ajustement manuel";
    const cleanedNote = ledgerNote.trim();
    try {
      setLedgerSaving(true);
      setMessage("");
      await addDoc(collection(firebaseDb, collectionName, viewingEntry.id, "ledger"), {
        type: ledgerDirection === "credit" ? "manual_credit" : "manual_debit",
        amount: signedAmount,
        label: cleanedLabel,
        note: cleanedNote || null,
        memberId: viewingEntry.id,
        createdAt: serverTimestamp(),
        occurredAt: serverTimestamp(),
      });
      setLedgerAmount("0");
      setLedgerNote("");
      setMessage("Opération enregistrée.");
      await loadMemberLedger(viewingEntry.id);
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setLedgerSaving(false);
    }
  };

  const openEdit = (entry: DocEntry) => {
    setEditingId(entry.id);
    const normalizedDraft = { ...entry.data };
    if (!getByPath(normalizedDraft, "membershipJoinedAt") && getByPath(normalizedDraft, "membershipPaymentDate")) {
      setByPath(normalizedDraft, "membershipJoinedAt", getByPath(normalizedDraft, "membershipPaymentDate"));
    }
    const emails = extractEmails(normalizedDraft);
    const phones = extractPhones(normalizedDraft);
    normalizedDraft.emails = emails;
    normalizedDraft.phones = phones;
    normalizedDraft.email = emails[0] ?? "";
    normalizedDraft.phone = phones[0] ?? "";
    setEditDraft(normalizedDraft);
    setEditEmails(emails);
    setEditPhones(phones);
    setEditPassword("");
    setLastSetPassword("");
    setMessage("");
  };

  const setEditingMemberPassword = async () => {
    if (!isAdmin || !editingId) return;
    const password = editPassword.trim();
    const normalizedEmails = uniqueList(editEmails).map((value) => value.toLowerCase());
    if (password.length < 6) {
      setMessage("Le mot de passe doit contenir au moins 6 caracteres.");
      return;
    }
    if (!normalizedEmails.length) {
      setMessage("Ajoute un email principal avant de definir le mot de passe.");
      return;
    }

    try {
      setPasswordSaving(true);
      setMessage("");
      const result = await syncMemberAuth({
        action: "password",
        memberId: editingId,
        email: normalizedEmails[0],
        emails: normalizedEmails,
        role: getByPath(editDraft, "auth.role") ?? "member",
        password,
      });
      setLastSetPassword(password);
      setEditPassword("");
      setMessage(
        result.createdAuthUser
          ? "Mot de passe defini. Compte de connexion cree et utilisable immediatement."
          : "Mot de passe defini, utilisable immediatement.",
      );
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setPasswordSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const normalizedEmails = uniqueList(editEmails).map((value) => value.toLowerCase());
      const normalizedPhones = uniqueList(editPhones);
      if (!normalizedEmails.length || !normalizedPhones.length) {
        setMessage("Ajoute au moins un email et un téléphone.");
        return;
      }
      const payload: Record<string, unknown> = {
        ...editDraft,
        emails: normalizedEmails,
        phones: normalizedPhones,
        email: normalizedEmails[0],
        phone: normalizedPhones[0],
        accessEmails: normalizedEmails.map((value) => value.toLowerCase()),
        accountLabel: deleteField(),
        sharedAccountEnabled: deleteField(),
        secondaryFirstName: deleteField(),
        secondaryLastName: deleteField(),
        secondaryEmail: deleteField(),
        secondaryPhone: deleteField(),
      };
      if (!isAdmin) {
        const existing = docs.find((entry) => entry.id === editingId)?.data ?? {};
        payload.membershipStatus = getByPath(existing, "membershipStatus") ?? "active";
        payload.membershipPaymentStatus = getByPath(existing, "membershipPaymentStatus") ?? "to_pay";
        payload.membershipJoinedAt =
          getByPath(existing, "membershipJoinedAt") ??
          getByPath(existing, "membershipPaymentDate") ??
          null;
      }
      if (!payload.membershipStatus) payload.membershipStatus = "active";
      if (!payload.membershipPaymentStatus) payload.membershipPaymentStatus = "to_pay";
      if (
        String(payload.membershipPaymentStatus ?? "").toLowerCase() !== "up_to_date" ||
        !payload.membershipJoinedAt
      ) {
        payload.membershipJoinedAt = null;
      }
      const syncResult = await syncMemberAuth({
        action: "sync",
        memberId: editingId,
        email: normalizedEmails[0],
        emails: normalizedEmails,
        role: getByPath(payload, "auth.role") ?? "member",
      });
      await setDoc(doc(firebaseDb, collectionName, editingId), payload, { merge: true });
      setMessage(
        syncResult.createdAuthUser
          ? "Adherent mis a jour. Compte de connexion recree avec le mot de passe temporaire."
          : "Adhérent mis à jour.",
      );
      setEditingId(null);
      setViewingEntry(null);
      setEditEmails([""]);
      setEditPhones([""]);
      setEditPassword("");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const deleteMemberLedger = async (targetMemberId: string) => {
    let deleted = 0;
    while (true) {
      const ledgerSnap = await getDocs(
        query(collection(firebaseDb, collectionName, targetMemberId, "ledger"), limit(350)),
      );
      if (ledgerSnap.empty) break;
      const batch = writeBatch(firebaseDb);
      ledgerSnap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
        deleted += 1;
      });
      await batch.commit();
    }
    return deleted;
  };

  const cleanupReferentLinks = async (targetMemberId: string) => {
    const now = Timestamp.now();
    let producerLinksUpdated = 0;
    let distributionLinksUpdated = 0;

    const producerSnap = await getDocs(
      query(collection(firebaseDb, "producers"), where("referentId", "==", targetMemberId)),
    );
    if (!producerSnap.empty) {
      const batch = writeBatch(firebaseDb);
      let count = 0;
      producerSnap.docs.forEach((docSnap) => {
        batch.set(
          docSnap.ref,
          {
            referentId: null,
            referentName: null,
            referentPhone: null,
            updatedAt: now,
          },
          { merge: true },
        );
        producerLinksUpdated += 1;
        count += 1;
      });
      if (count > 0) await batch.commit();
    }

    const distributionsSnap = await getDocs(collection(firebaseDb, "distributionDates"));
    for (const distributionDoc of distributionsSnap.docs) {
      const rowsSnap = await getDocs(
        query(
          collection(firebaseDb, "distributionDates", distributionDoc.id, "producers"),
          where("referentId", "==", targetMemberId),
        ),
      );
      if (rowsSnap.empty) continue;

      const batch = writeBatch(firebaseDb);
      let count = 0;
      rowsSnap.docs.forEach((rowDoc) => {
        batch.set(
          rowDoc.ref,
          {
            referentId: null,
            referentName: null,
            validatedByReferent: false,
            validatedAt: null,
            updatedAt: now,
          },
          { merge: true },
        );
        distributionLinksUpdated += 1;
        count += 1;
      });
      if (count > 0) await batch.commit();
    }

    return { producerLinksUpdated, distributionLinksUpdated };
  };

  const deleteEditingMember = async () => {
    if (!isAdmin || !editingId) return;
    if (memberId && editingId === memberId) {
      setMessage("Tu ne peux pas supprimer ton propre compte.");
      return;
    }

    const targetEntry = docs.find((entry) => entry.id === editingId);
    const targetData = targetEntry?.data ?? editDraft;
    const targetRole = String(getByPath(targetData, "auth.role") ?? "member").toLowerCase();
    const adminCount = docs.filter(
      (entry) => String(getByPath(entry.data, "auth.role") ?? "member").toLowerCase() === "admin",
    ).length;
    if (targetRole === "admin" && adminCount <= 1) {
      setMessage("Suppression bloquee: il faut conserver au moins un admin.");
      return;
    }

    const firstName = String(getByPath(targetData, "firstName") ?? "").trim();
    const lastName = String(getByPath(targetData, "lastName") ?? "").trim();
    const displayName = `${firstName} ${lastName}`.trim() || editingId;
    const assignedProducersCount = producers.filter((producer) => producer.referentId === editingId).length;
    const warningText = [
      `Supprimer definitivement "${displayName}" (${formatRole(targetRole)}) ?`,
      "",
      "Cette action supprime aussi l'historique de solde (ledger).",
      assignedProducersCount > 0
        ? `Les ${assignedProducersCount} producteur(s) reliés à ce référent seront dissociés.`
        : "Aucun producteur lié à ce membre.",
      "",
      "Action irreversible.",
    ].join("\n");

    const confirmed = typeof window === "undefined" ? true : window.confirm(warningText);
    if (!confirmed) return;

    try {
      setDeletingMember(true);
      setMessage("");

      const deletedLedger = await deleteMemberLedger(editingId);
      const cleanup = await cleanupReferentLinks(editingId);
      await syncMemberAuth({
        action: "delete",
        memberId: editingId,
      });

      setMessage(
        `Membre supprime. Ledger: ${deletedLedger} ligne(s), producteurs nettoyes: ${cleanup.producerLinksUpdated}, lignes distributions nettoyees: ${cleanup.distributionLinksUpdated}.`,
      );
      setEditingId(null);
      setViewingEntry((prev) => (prev?.id === editingId ? null : prev));
      setEditEmails([""]);
      setEditPhones([""]);
      setEditPassword("");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setDeletingMember(false);
    }
  };

  const handleCreate = async () => {
    const firstName = createFirstName.trim();
    const lastName = createLastName.trim();
    const email = createEmail.trim();
    if (!firstName || !lastName || !email) {
      setMessage("Prénom, nom et email sont obligatoires.");
      return;
    }
    try {
      setCreateSubmitting(true);
      const response = await fetch("/api/members/create", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setMessage(result.error || "Erreur inconnue.");
        return;
      }
      setCreateFirstName("");
      setCreateLastName("");
      setCreateEmail("");
      setCreateOpen(false);
      setMessage("Adhérent créé, email envoyé.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const filteredDocs = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return docs.filter((entry) => {
      const status = String(getByPath(entry.data, "membershipStatus") ?? "");
      const role = String(getByPath(entry.data, "auth.role") ?? "member") || "member";
      if (filterStatus !== "all" && status !== filterStatus) return false;
      if (viewMode === "adherents" && role !== "member") return false;
      if (viewMode === "coopMembers" && role !== "admin" && role !== "referent") return false;
      if (filterRole !== "all" && role !== filterRole) return false;
      if (!term) return true;
      const haystack = [
        entry.id,
        getByPath(entry.data, "firstName"),
        getByPath(entry.data, "lastName"),
        getByPath(entry.data, "email"),
        ...(toList(getByPath(entry.data, "emails")) ?? []),
        ...(toList(getByPath(entry.data, "phones")) ?? []),
        getByPath(entry.data, "membershipStatus"),
        getByPath(entry.data, "auth.role"),
      ]
        .map((value) => (value ? String(value).toLowerCase() : ""))
        .join(" ");
      return haystack.includes(term);
    });
  }, [docs, filter, filterRole, filterStatus, viewMode]);

  const sortedDocs = useMemo(() => {
    const items = [...filteredDocs];
    items.sort((a, b) => {
      const aValue = getByPath(a.data, sortKey);
      const bValue = getByPath(b.data, sortKey);
      const aText = aValue instanceof Timestamp ? aValue.toDate().getTime() : String(aValue ?? "");
      const bText = bValue instanceof Timestamp ? bValue.toDate().getTime() : String(bValue ?? "");
      if (aText < bText) return sortDir === "asc" ? -1 : 1;
      if (aText > bText) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return items;
  }, [filteredDocs, sortDir, sortKey]);

  const toggleSort = (path: string) => {
    if (sortKey === path) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(path);
      setSortDir("asc");
    }
  };

  const viewingLedger = viewingEntry ? (ledgerByMemberId[viewingEntry.id] ?? []) : [];
  const viewingBalance = viewingLedger.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  const roleCounts = useMemo(() => {
    return docs.reduce(
      (acc, entry) => {
        const entryRole = String(getByPath(entry.data, "auth.role") ?? "member").toLowerCase();
        if (entryRole === "admin") {
          acc.admin += 1;
        } else if (entryRole === "referent") {
          acc.referent += 1;
        } else {
          acc.member += 1;
        }
        return acc;
      },
      { member: 0, referent: 0, admin: 0 },
    );
  }, [docs]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">{title}</h2>
        {description ? <p className="mt-2 text-sm text-ink/70">{description}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {viewMode === "adherents" ? (
            <span className="rounded-full border border-ink/20 bg-white px-3 py-1 font-semibold text-ink/80">
              Membres: {roleCounts.member}
            </span>
          ) : null}
          {viewMode === "coopMembers" ? (
            <>
              <span className="rounded-full border border-ink/20 bg-white px-3 py-1 font-semibold text-ink/80">
                Referents: {roleCounts.referent}
              </span>
              <span className="rounded-full border border-ink/20 bg-white px-3 py-1 font-semibold text-ink/80">
                Admins: {roleCounts.admin}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-clay/70 bg-white/80 p-4 shadow-card">
        <input
          className="w-full max-w-sm rounded-full border border-ink/20 bg-white px-4 py-2 text-sm"
          placeholder="Rechercher un adhérent..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value)}
        >
          <option value="all">Tous les statuts</option>
          <option value="active">Actif</option>
          <option value="inactive">Inactif</option>
        </select>
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={filterRole}
          onChange={(event) => setFilterRole(event.target.value)}
        >
          {roleFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
          onClick={() => {
            setFilter("");
            setFilterStatus("all");
            setFilterRole(viewMode === "adherents" ? "member" : "all");
          }}
        >
          Réinitialiser
        </button>
        <button
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          onClick={() => {
            setCreateOpen(true);
            setCreateFirstName("");
            setCreateLastName("");
            setCreateEmail("");
            setMessage("");
          }}
        >
          Nouveau
        </button>
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/80 shadow-card">
        {loading ? (
          <p className="p-6 text-sm text-ink/70">Chargement...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-clay/70 bg-stone/80">
                <tr>
                  {tableFields.map((field) => (
                    <th
                      key={field.path}
                      className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-ink"
                      onClick={() => toggleSort(field.path)}
                    >
                      {field.label}
                      {sortKey === field.path ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                  {balanceTrackingEnabled ? (
                    <th className="px-3 py-1.5 text-xs font-semibold text-ink">Solde</th>
                  ) : null}
                  {showAssignedProducersColumn ? (
                    <th className="px-3 py-1.5 text-xs font-semibold text-ink">Producteurs</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sortedDocs.map((entry) => (
                  <tr
                    key={entry.id}
                    className="cursor-pointer border-b border-clay/50 hover:bg-stone/60"
                    onClick={() => openView(entry)}
                  >
                    {tableFields.map((field) => (
                      <td key={field.path} className="px-3 py-1.5 text-xs text-ink/70">
                        {field.path === "membershipStatus"
                          ? formatMembershipStatus(getByPath(entry.data, field.path))
                          : field.path === "membershipPaymentStatus"
                            ? formatMembershipPaymentStatus(getByPath(entry.data, field.path))
                            : field.path === "membershipJoinedAt"
                              ? formatDateValue(
                                  getByPath(entry.data, "membershipJoinedAt") ??
                                    getByPath(entry.data, "membershipPaymentDate"),
                                )
                          : field.path === "auth.role"
                            ? formatRole(getByPath(entry.data, field.path))
                            : displayValue(getByPath(entry.data, field.path))}
                      </td>
                    ))}
                    {balanceTrackingEnabled ? (
                      <td className="px-3 py-1.5 text-xs">
                        {(() => {
                          const balance = Number(balanceByMemberId[entry.id] ?? 0);
                          if (Math.abs(balance) < 0.000001) {
                            return <span className="text-ink/55">-</span>;
                          }
                          return (
                            <span className={balance < 0 ? "font-semibold text-ember" : "font-semibold text-forest"}>
                              {formatMoney(balance)} EUR
                            </span>
                          );
                        })()}
                      </td>
                    ) : null}
                    {showAssignedProducersColumn ? (
                      <td className="px-3 py-1.5 text-xs text-ink/70">
                        {producers.filter((producer) => producer.referentId === entry.id).length}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {viewingEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Fiche adhérent</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Nom</p>
                <p className="text-sm text-ink">
                  {`${String(getByPath(viewingEntry.data, "firstName") ?? "")} ${String(
                    getByPath(viewingEntry.data, "lastName") ?? "",
                  )}`.trim() || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Email</p>
                <p className="text-sm text-ink">
                  {(() => {
                    const emails = extractEmails(viewingEntry.data).filter(Boolean);
                    return emails.length ? emails.join(" · ") : "-";
                  })()}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Téléphone</p>
                <p className="text-sm text-ink">
                  {(() => {
                    const phones = extractPhones(viewingEntry.data).filter(Boolean);
                    return phones.length ? phones.join(" · ") : "-";
                  })()}
                </p>
              </div>
              <div className="md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adresse</p>
                <p className="text-sm text-ink">
                  {[
                    String(getByPath(viewingEntry.data, "address.street") ?? "").trim(),
                    String(getByPath(viewingEntry.data, "address.postalCode") ?? "").trim(),
                    String(getByPath(viewingEntry.data, "address.city") ?? "").trim(),
                  ]
                    .filter(Boolean)
                    .join(" ")
                    || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Statut</p>
                <p className="text-sm text-ink">
                  {formatMembershipStatus(getByPath(viewingEntry.data, "membershipStatus"))}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adhésion</p>
                <p className="text-sm text-ink">
                  {formatMembershipPaymentStatus(getByPath(viewingEntry.data, "membershipPaymentStatus"))}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Date adhésion</p>
                <p className="text-sm text-ink">
                  {String(getByPath(viewingEntry.data, "membershipPaymentStatus") ?? "").toLowerCase() === "up_to_date"
                    ? formatDateValue(
                        getByPath(viewingEntry.data, "membershipJoinedAt") ??
                          getByPath(viewingEntry.data, "membershipPaymentDate"),
                      )
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">N° adhésion</p>
                <p className="text-sm text-ink">{displayValue(getByPath(viewingEntry.data, "membershipNumber"))}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Rôle</p>
                <p className="text-sm text-ink">
                  {formatRole(getByPath(viewingEntry.data, "auth.role") ?? "member")}
                </p>
              </div>
            </div>
            {balanceTrackingEnabled ? (
              <div className="mt-6 rounded-2xl border border-clay/70 bg-stone/50 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Solde</p>
                    <p className={`mt-1 text-2xl font-semibold ${viewingBalance >= 0 ? "text-forest" : "text-ember"}`}>
                      {viewingBalance >= 0 ? "+" : "-"} {formatMoney(Math.abs(viewingBalance))} EUR
                    </p>
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={ledgerDirection}
                        onChange={(event) =>
                          setLedgerDirection(event.target.value === "debit" ? "debit" : "credit")
                        }
                      >
                        <option value="credit">Ajouter</option>
                        <option value="debit">Retirer</option>
                      </select>
                      <input
                        className="w-32 rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={ledgerAmount}
                        onChange={(event) => setLedgerAmount(event.target.value)}
                        placeholder="Montant"
                      />
                      <button
                        className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-stone disabled:opacity-50"
                        onClick={() => submitLedgerOperation().catch(() => undefined)}
                        disabled={ledgerSaving}
                      >
                        {ledgerSaving ? "Enregistrement..." : "Valider"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {isAdmin ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <input
                      className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={ledgerLabel}
                      onChange={(event) => setLedgerLabel(event.target.value)}
                      placeholder="Libellé"
                    />
                    <input
                      className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={ledgerNote}
                      onChange={(event) => setLedgerNote(event.target.value)}
                      placeholder="Note (optionnel)"
                    />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink/60">Lecture seule pour ce rôle.</p>
                )}

                <div className="mt-3 overflow-hidden rounded-xl border border-clay/70 bg-white">
                  <div className="grid grid-cols-[120px_1fr_120px] border-b border-clay/70 bg-stone px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/60">
                    <span>Date</span>
                    <span>Mouvement</span>
                    <span className="text-right">Montant</span>
                  </div>
                  <div className="max-h-56 divide-y divide-clay/60 overflow-y-auto">
                    {ledgerLoadingMemberId === viewingEntry.id ? (
                      <p className="px-3 py-3 text-sm text-ink/65">Chargement des mouvements...</p>
                    ) : viewingLedger.length ? (
                      viewingLedger.map((entry) => (
                        <div key={entry.id} className="grid grid-cols-[120px_1fr_120px] items-center px-3 py-2 text-sm">
                          <span className="text-ink/65">{entryDate(entry).toLocaleDateString("fr-FR")}</span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{entry.label ?? "Mouvement"}</p>
                            {entry.note ? <p className="truncate text-xs text-ink/60">{entry.note}</p> : null}
                          </div>
                          <span
                            className={`text-right font-semibold ${Number(entry.amount ?? 0) >= 0 ? "text-forest" : "text-ember"}`}
                          >
                            {Number(entry.amount ?? 0) >= 0 ? "+" : "-"}
                            {formatMoney(Math.abs(Number(entry.amount ?? 0)))} EUR
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="px-3 py-3 text-sm text-ink/65">Aucun mouvement.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {String(getByPath(viewingEntry.data, "auth.role") ?? "") === "referent" ? (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                  Producteurs
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink/70">
                  {producers
                    .filter((producer) => producer.referentId === viewingEntry.id)
                    .map((producer) => (
                      <a
                        key={producer.id}
                        href={`/admin/producers/${producer.id}`}
                        className="rounded-full border border-ink/15 px-3 py-1"
                      >
                        {producer.name ?? "Producteur"}
                      </a>
                    ))}
                  {!producers.some((producer) => producer.referentId === viewingEntry.id) ? (
                    <span className="text-xs text-ink/60">Aucun producteur attribué.</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex items-center gap-3">
              {canEditMembers ? (
                <button
                  className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white"
                  onClick={() => {
                    setViewingEntry(null);
                    openEdit(viewingEntry);
                  }}
                >
                  Éditer
                </button>
              ) : null}
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => setViewingEntry(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Éditer adhérent</h3>
            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-4 md:grid-cols-2">
                {formFields.map((field) => {
                  const value = getByPath(editDraft, field.path);
                  const inputValue = toInputValue(value, field.type);
                  const adminOnlyField = [
                    "membershipStatus",
                    "membershipPaymentStatus",
                    "membershipJoinedAt",
                    "membershipNumber",
                  ].includes(field.path);
                  const fieldDisabled = adminOnlyField && !isAdmin;
                  const paymentDateLocked =
                    field.path === "membershipJoinedAt" &&
                    String(getByPath(editDraft, "membershipPaymentStatus") ?? "").toLowerCase() !== "up_to_date";
                  return (
                    <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                      {field.label}
                      {field.path === "auth.role" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue || "member")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                          disabled={!isAdmin}
                        >
                          <option value="member">Membre</option>
                          <option value="referent">Référent</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : field.path === "membershipStatus" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue || "active")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                          disabled={fieldDisabled}
                        >
                          <option value="active">Actif</option>
                          <option value="inactive">Inactif</option>
                        </select>
                      ) : field.path === "membershipPaymentStatus" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue || "to_pay")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            const nextValue = event.target.value;
                            setByPath(next, field.path, nextValue);
                            if (nextValue !== "up_to_date") {
                              setByPath(next, "membershipJoinedAt", null);
                            }
                            setEditDraft(next);
                          }}
                          disabled={fieldDisabled}
                        >
                          <option value="up_to_date">Payé</option>
                          <option value="to_pay">Non payé</option>
                        </select>
                      ) : field.type === "boolean" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue)}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                            setEditDraft(next);
                          }}
                          disabled={fieldDisabled}
                        >
                          <option value="true">Oui</option>
                          <option value="false">Non</option>
                        </select>
                      ) : field.type === "date" || field.type === "datetime" ? (
                        <input
                          type={field.type === "date" ? "date" : "datetime-local"}
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue)}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                            setEditDraft(next);
                          }}
                          disabled={fieldDisabled || paymentDateLocked}
                        />
                      ) : (
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue)}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                            setEditDraft(next);
                          }}
                          disabled={fieldDisabled}
                        />
                      )}
                    </label>
                  );
                })}
                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Emails</p>
                  <div className="flex flex-col gap-2">
                    {editEmails.map((value, index) => (
                      <div key={`edit-email-${index}`} className="flex items-center gap-2">
                        <input
                          className="flex-1 rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          type="email"
                          value={value}
                          onChange={(event) =>
                            setEditEmails((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))
                          }
                        />
                        {editEmails.length > 1 ? (
                          <button
                            className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                            onClick={() => setEditEmails((prev) => prev.filter((_, i) => i !== index))}
                          >
                            Retirer
                          </button>
                        ) : null}
                      </div>
                    ))}
                    <button
                      className="w-fit rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                      onClick={() => setEditEmails((prev) => [...prev, ""])}
                    >
                      + Ajouter un email
                    </button>
                  </div>
                </div>
                {isAdmin ? (
                  <div className="md:col-span-2 rounded-xl border border-clay/70 bg-stone/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                      Mot de passe
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                        Nouveau mot de passe
                        <input
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          type="text"
                          value={editPassword}
                          onChange={(event) => setEditPassword(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone disabled:opacity-50"
                        onClick={() => setEditingMemberPassword().catch(() => undefined)}
                        disabled={passwordSaving || deletingMember}
                      >
                        {passwordSaving ? "Mise a jour..." : "Definir"}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-forest/30 bg-white px-3 py-1.5 text-xs font-semibold text-forest"
                        onClick={() => setEditPassword(DEFAULT_MEMBER_PASSWORD)}
                        disabled={passwordSaving || deletingMember}
                      >
                        Utiliser brouette2026
                      </button>
                      {lastSetPassword ? (
                        <span className="rounded-full bg-forest/10 px-3 py-1.5 text-xs font-semibold text-forest">
                          Dernier mot de passe defini : {lastSetPassword}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-ink/60">
                      Les mots de passe existants ne sont pas lisibles. L&apos;admin peut definir un nouveau mot de passe,
                      actif immediatement, sans changement impose a la connexion.
                    </p>
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Téléphones</p>
                  <div className="flex flex-col gap-2">
                    {editPhones.map((value, index) => (
                      <div key={`edit-phone-${index}`} className="flex items-center gap-2">
                        <input
                          className="flex-1 rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={value}
                          onChange={(event) =>
                            setEditPhones((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))
                          }
                        />
                        {editPhones.length > 1 ? (
                          <button
                            className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                            onClick={() => setEditPhones((prev) => prev.filter((_, i) => i !== index))}
                          >
                            Retirer
                          </button>
                        ) : null}
                      </div>
                    ))}
                    <button
                      className="w-fit rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                      onClick={() => setEditPhones((prev) => [...prev, ""])}
                    >
                      + Ajouter un téléphone
                    </button>
                  </div>
                </div>
              </div>

            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-ink/10 pt-4">
              <button
                className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white"
                onClick={saveEdit}
                disabled={deletingMember || passwordSaving}
              >
                Enregistrer
              </button>
              {isAdmin ? (
                <button
                  className="rounded-full border border-ember/40 px-4 py-2 text-sm font-semibold text-ember disabled:opacity-50"
                  onClick={() => deleteEditingMember().catch(() => undefined)}
                  disabled={deletingMember || passwordSaving}
                >
                  {deletingMember ? "Suppression..." : "Supprimer"}
                </button>
              ) : null}
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => setEditingId(null)}
                disabled={deletingMember || passwordSaving}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-md rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Nouvel adhérent</h3>
            <p className="mt-2 text-sm text-ink/70">
              Un mot de passe par défaut (brouette2026) sera attribué et envoyé par email. Il devra
              être changé à la première connexion.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Prénom
                <input
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                  value={createFirstName}
                  onChange={(event) => setCreateFirstName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Nom
                <input
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                  value={createLastName}
                  onChange={(event) => setCreateLastName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Email
                <input
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                  type="email"
                  value={createEmail}
                  onChange={(event) => setCreateEmail(event.target.value)}
                />
              </label>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone disabled:opacity-50"
                onClick={() => handleCreate().catch(() => undefined)}
                disabled={createSubmitting}
              >
                {createSubmitting ? "Création..." : "Créer"}
              </button>
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => setCreateOpen(false)}
                disabled={createSubmitting}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

