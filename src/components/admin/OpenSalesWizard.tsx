"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseDb } from "@/lib/firebase/client";
import {
  distributionLabel,
  isDistributionExpired,
  isOpenStatus,
  pickOpenDistribution,
} from "@/lib/distributions";

type FireDate = { toDate?: () => Date };

type Distribution = {
  id: string;
  status?: string;
  dates?: FireDate[];
  openedAt?: FireDate;
  closeAt?: FireDate;
};
type Producer = {
  id: string;
  name?: string;
  referentId?: string | null;
  referentName?: string | null;
};
type Member = { id: string; firstName?: string; lastName?: string };
type Order = { distributionId?: string | null; memberId?: string | null; totals?: { totalAmount?: number } };
type Variant = { id: string; label: string; price: number; activeDates: string[] };
type Product = {
  id: string;
  producerId: string;
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  saleLimit?: number | null;
  variants: Variant[];
};

type DistributionMetrics = {
  producersActive: number;
  producersValidated: number;
  offersCount: number;
  productsCount: number;
  ordersCount: number;
};

type ProducerRow = {
  producerId: string;
  producerName: string;
  referentId: string | null;
  referentName: string;
  validatedByReferent: boolean;
  validatedAtLabel: string;
  productCount: number;
};

type CalendarProducerLink = {
  producerId?: string;
  activeDateKeys?: string[];
};

type VariantDraft = {
  id?: string;
  tempId: string;
  label: string;
  price: number;
  activeDates: string[];
};

type ProductDraft = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  variants: VariantDraft[];
  existingVariantIds: string[];
};

type SalesViewMode = "overview" | "current" | "next" | "history";

const FINISHED = new Set(["finished", "fermee", "ferme", "closed"]);

const toDate = (value?: FireDate) => value?.toDate?.() ?? null;
const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const formatDate = (value?: Date | null) =>
  value
    ? value.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "-";
const formatLongDate = (value?: Date | null) =>
  value
    ? value.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : "-";
const formatBadgeDate = (value?: Date | null) =>
  value
    ? value
        .toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })
        .replace(/\.$/, "")
    : "-";
const distributionDateBadges = (distribution?: Distribution | null) =>
  (distribution?.dates ?? [])
    .slice(0, 3)
    .map((date) => formatBadgeDate(toDate(date)))
    .filter((label) => label !== "-");
const money = (value: number) => value.toFixed(2).replace(".", ",");
const isPlanned = (status?: string) =>
  !isOpenStatus(status) && !FINISHED.has(String(status ?? "").toLowerCase());
const fullName = (m?: Member | null) => `${m?.firstName ?? ""} ${m?.lastName ?? ""}`.trim();
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const sameStringSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
};

export default function OpenSalesWizard({ mode = "overview" }: { mode?: SalesViewMode }) {
  const router = useRouter();
  const { effectiveRole, effectiveMemberId } = useAuth();
  const isAdmin = effectiveRole === "admin";
  const isReferent = effectiveRole === "referent";
  const canManageAdmin = isAdmin || isReferent;
  const canManageLifecycle = isAdmin;
  const isOverviewMode = mode === "overview";
  const isCurrentMode = mode === "current";
  const isNextMode = mode === "next";
  const isHistoryMode = mode === "history";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [membersById, setMembersById] = useState<Record<string, Member>>({});
  const [productsByProducer, setProductsByProducer] = useState<Record<string, Product[]>>({});
  const [rows, setRows] = useState<ProducerRow[]>([]);
  const [saleOverview, setSaleOverview] = useState({
    offerCount: 0,
    offerProducerCount: 0,
    orderCount: 0,
    memberCount: 0,
    revenue: 0,
    averageBasket: 0,
  });
  const [distributionMetrics, setDistributionMetrics] = useState<Record<string, DistributionMetrics>>({});

  const [flowOpen, setFlowOpen] = useState(false);
  const [flowProducerIds, setFlowProducerIds] = useState<string[]>([]);
  const [flowIndex, setFlowIndex] = useState(0);
  const [draftProducts, setDraftProducts] = useState<ProductDraft[]>([]);

  const openDistribution = useMemo(() => pickOpenDistribution(distributions), [distributions]);
  const plannedDistributions = useMemo(
    () =>
      distributions
        .filter((distribution) => isPlanned(distribution.status))
        .sort(
          (left, right) =>
            (toDate(left.dates?.[0]) ?? new Date(0)).getTime() -
            (toDate(right.dates?.[0]) ?? new Date(0)).getTime(),
        ),
    [distributions],
  );
  const nextPlannedDistribution = plannedDistributions[0] ?? null;
  const targetDistribution = useMemo(() => {
    if (isCurrentMode) return openDistribution ?? null;
    if (isNextMode || isOverviewMode) return nextPlannedDistribution ?? null;
    return null;
  }, [isCurrentMode, isNextMode, isOverviewMode, openDistribution, nextPlannedDistribution]);
  const saleDates = useMemo(
    () =>
      ((targetDistribution?.dates ?? []).slice(0, 3).map((d) => toDate(d)).filter(Boolean) as Date[]).map((d) => ({
        key: dateKey(d),
        label: formatDate(d),
      })),
    [targetDistribution],
  );
  const saleDateKeys = useMemo(() => saleDates.map((d) => d.key), [saleDates]);
  const openDistributionDates = useMemo(
    () => distributionDateBadges(openDistribution),
    [openDistribution],
  );
  const nextDistributionDates = useMemo(
    () => distributionDateBadges(nextPlannedDistribution),
    [nextPlannedDistribution],
  );
  const targetDistributionDates = useMemo(
    () => distributionDateBadges(targetDistribution),
    [targetDistribution],
  );

  const currentProducerId = flowProducerIds[flowIndex] ?? "";
  const currentProducer = useMemo(
    () => producers.find((producer) => producer.id === currentProducerId) ?? null,
    [currentProducerId, producers],
  );
  const currentRow = useMemo(
    () => rows.find((row) => row.producerId === currentProducerId) ?? null,
    [currentProducerId, rows],
  );

  const syncRows = useCallback(
    async (
      distributionId: string,
      producerList: Producer[],
      memberMap: Record<string, Member>,
      productMap: Record<string, Product[]>,
      distributionDateKeys: string[],
    ) => {
      if (!distributionId) {
        setRows([]);
        return;
      }

      const producerById: Record<string, Producer> = {};
      producerList.forEach((producer) => {
        producerById[producer.id] = producer;
      });
      const calendarSnap = await getDocs(
        collection(firebaseDb, "distributionDates", distributionId, "calendarProducers"),
      );
      const calendarByProducer = new Map<string, string[]>();
      calendarSnap.docs.forEach((calendarDoc) => {
        const data = calendarDoc.data() as CalendarProducerLink;
        const producerId = String(data.producerId ?? calendarDoc.id);
        const activeDateKeys = Array.isArray(data.activeDateKeys)
          ? data.activeDateKeys.filter((key): key is string => typeof key === "string")
          : [];
        calendarByProducer.set(producerId, activeDateKeys);
      });
      const useCalendar = calendarSnap.size > 0;

      const producerIds = Object.keys(productMap).filter((id) => {
        if ((productMap[id] ?? []).length === 0 || !producerById[id]) return false;
        if (!useCalendar) return true;
        const activeDateKeys = calendarByProducer.get(id) ?? [];
        return activeDateKeys.some((key) => distributionDateKeys.includes(key));
      });
      const producerSet = new Set(producerIds);

      const linkSnap = await getDocs(collection(firebaseDb, "distributionDates", distributionId, "producers"));
      const existing = new Map<
        string,
        {
          validatedByReferent?: boolean;
          validatedAt?: FireDate;
          referentId?: string | null;
          referentName?: string | null;
          activeDateKeys?: string[];
        }
      >();
      linkSnap.docs.forEach((linkDoc) => existing.set(linkDoc.id, linkDoc.data() as never));

      const batch = writeBatch(firebaseDb);
      let changed = false;

      linkSnap.docs.forEach((linkDoc) => {
        if (!producerSet.has(linkDoc.id)) {
          batch.delete(linkDoc.ref);
          changed = true;
        }
      });

      const nextRows = producerIds.map((producerId) => {
        const producer = producerById[producerId];
        const dbRow = existing.get(producerId);
        const activeDateKeys = (
          useCalendar
            ? (calendarByProducer.get(producerId) ?? []).filter((key) => distributionDateKeys.includes(key))
            : [...distributionDateKeys]
        ).sort();
        const referentId = producer?.referentId ?? dbRow?.referentId ?? null;
        const referentName =
          fullName(referentId ? memberMap[referentId] : null) ||
          producer?.referentName ||
          dbRow?.referentName ||
          "Sans referent";

        if (
          !dbRow ||
          referentId !== (dbRow?.referentId ?? null) ||
          referentName !== String(dbRow?.referentName ?? "") ||
          !sameStringSet(activeDateKeys, Array.isArray(dbRow?.activeDateKeys) ? dbRow.activeDateKeys : [])
        ) {
          batch.set(
            doc(firebaseDb, "distributionDates", distributionId, "producers", producerId),
            {
              producerId,
              referentId,
              referentName,
              active: true,
              activeDateKeys,
              validatedByReferent: false,
              validatedAt: null,
            },
            { merge: true },
          );
          changed = true;
        }

        return {
          producerId,
          producerName: producer?.name ?? "Producteur",
          referentId,
          referentName,
          validatedByReferent: dbRow?.validatedByReferent === true,
          validatedAtLabel: formatLongDate(toDate(dbRow?.validatedAt)),
          productCount: (productMap[producerId] ?? []).length,
        } satisfies ProducerRow;
      });

      if (changed) await batch.commit();
      setRows(nextRows.sort((a, b) => a.producerName.localeCompare(b.producerName)));
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);

    const [initialDistSnap, producerSnap, memberSnap, orderSnap, productSnap, variantSnap] = await Promise.all([
      getDocs(collection(firebaseDb, "distributionDates")),
      getDocs(collection(firebaseDb, "producers")),
      getDocs(collection(firebaseDb, "members")),
      getDocs(collection(firebaseDb, "orders")),
      getDocs(collection(firebaseDb, "products")),
      getDocs(collectionGroup(firebaseDb, "variants")),
    ]);

    let distSnap = initialDistSnap;
    let distItems = distSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Distribution, "id">) }));

    const autoClosed = distItems.filter((distribution) =>
      isOpenStatus(distribution.status) && isDistributionExpired(distribution),
    );

    if (autoClosed.length > 0) {
      const batch = writeBatch(firebaseDb);
      autoClosed.forEach((distribution) => {
        batch.update(doc(firebaseDb, "distributionDates", distribution.id), {
          status: "finished",
          closedAt: Timestamp.now(),
        });
      });
      await batch.commit();
      distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
      distItems = distSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Distribution, "id">) }));
      setMessage(
        `${autoClosed.length} vente(s) fermee(s) automatiquement (date limite depassee).`,
      );
    }

    distItems.sort(
      (a, b) =>
        (toDate(a.dates?.[0]) ?? new Date(0)).getTime() -
        (toDate(b.dates?.[0]) ?? new Date(0)).getTime(),
    );
    setDistributions(distItems);

    const producerItems = producerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Producer, "id">) }));
    producerItems.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    setProducers(producerItems);

    const memberMap: Record<string, Member> = {};
    memberSnap.docs.forEach((d) => {
      memberMap[d.id] = { id: d.id, ...(d.data() as Omit<Member, "id">) };
    });
    setMembersById(memberMap);

    const stats: Record<string, { count: number; amount: number }> = {};
    const orders = orderSnap.docs.map((d) => d.data() as Order);
    orderSnap.docs.forEach((d) => {
      const order = d.data() as Order;
      const key = String(order.distributionId ?? "");
      if (!key) return;
      const prev = stats[key] ?? { count: 0, amount: 0 };
      prev.count += 1;
      prev.amount += Number(order.totals?.totalAmount ?? 0);
      stats[key] = prev;
    });

    const variantsByProduct: Record<string, Variant[]> = {};
    variantSnap.docs.forEach((d) => {
      const productId = d.ref.parent.parent?.id;
      if (!productId) return;
      if (!variantsByProduct[productId]) variantsByProduct[productId] = [];
      const data = d.data() as { label?: string; price?: number; activeDates?: string[] };
      variantsByProduct[productId].push({
        id: d.id,
        label: String(data.label ?? "Variante"),
        price: Number(data.price ?? 0),
        activeDates: Array.isArray(data.activeDates) ? data.activeDates : [],
      });
    });

    const nextProductsByProducer: Record<string, Product[]> = {};
    productSnap.docs.forEach((d) => {
      const data = d.data() as {
        producerId?: string;
        name?: string;
        description?: string;
        imageUrl?: string;
        isOrganic?: boolean;
        saleLimit?: number | null;
      };
      const producerId = String(data.producerId ?? "");
      if (!producerId) return;
      if (!nextProductsByProducer[producerId]) nextProductsByProducer[producerId] = [];
      nextProductsByProducer[producerId].push({
        id: d.id,
        producerId,
        name: String(data.name ?? "Produit"),
        description: String(data.description ?? ""),
        imageUrl: String(data.imageUrl ?? ""),
        isOrganic: Boolean(data.isOrganic),
        saleLimit: data.saleLimit ?? null,
        variants: variantsByProduct[d.id] ?? [],
      });
    });
    Object.values(nextProductsByProducer).forEach((list) =>
      list.sort((a, b) => a.name.localeCompare(b.name)),
    );
    setProductsByProducer(nextProductsByProducer);

    const metricsEntries = await Promise.all(
      distItems.map(async (distribution) => {
        const [producersLinkSnap, offerSnap] = await Promise.all([
          getDocs(collection(firebaseDb, "distributionDates", distribution.id, "producers")),
          getDocs(collection(firebaseDb, "distributionDates", distribution.id, "offerItems")),
        ]);

        let producersActive = 0;
        let producersValidated = 0;
        producersLinkSnap.docs.forEach((linkDoc) => {
          const data = linkDoc.data() as {
            active?: boolean;
            activeDateKeys?: string[];
            validatedByReferent?: boolean;
          };
          const activeDateKeys = Array.isArray(data.activeDateKeys) ? data.activeDateKeys : [];
          const isActive = data.active !== false && activeDateKeys.length > 0;
          if (!isActive) return;
          producersActive += 1;
          if (data.validatedByReferent === true) producersValidated += 1;
        });

        const productIds = new Set(
          offerSnap.docs
            .map((docSnap) => String((docSnap.data() as { productId?: string }).productId ?? ""))
            .filter(Boolean),
        );

        const ordersCount = orders.filter(
          (order) => String(order.distributionId ?? "") === distribution.id,
        ).length;

        return [
          distribution.id,
          {
            producersActive,
            producersValidated,
            offersCount: offerSnap.size,
            productsCount: productIds.size,
            ordersCount,
          } satisfies DistributionMetrics,
        ] as const;
      }),
    );
    setDistributionMetrics(Object.fromEntries(metricsEntries));

    const open = pickOpenDistribution(distItems);
    const plannedDist = distItems.filter((d) => isPlanned(d.status));
    const defaultTarget = plannedDist[0]?.id ?? "";

    const defaultTargetDateKeys = (
      (distItems.find((distribution) => distribution.id === defaultTarget)?.dates ?? [])
        .slice(0, 3)
        .map((date) => toDate(date))
        .filter(Boolean) as Date[]
    ).map((date) => dateKey(date));
    await syncRows(defaultTarget, producerItems, memberMap, nextProductsByProducer, defaultTargetDateKeys);

    const overviewDistributionId = open?.id ?? "";
    if (overviewDistributionId) {
      const offerSnap = await getDocs(
        collection(firebaseDb, "distributionDates", overviewDistributionId, "offerItems"),
      );
      const offerProductIds = new Set(
        offerSnap.docs
          .map((docSnap) => String((docSnap.data() as { productId?: string }).productId ?? ""))
          .filter(Boolean),
      );
      const offerProducerIds = new Set(
        offerSnap.docs
          .map((docSnap) => String((docSnap.data() as { producerId?: string }).producerId ?? ""))
          .filter(Boolean),
      );
      const overviewOrders = orders.filter(
        (order) => String(order.distributionId ?? "") === overviewDistributionId,
      );
      const orderingMembers = new Set(
        overviewOrders.map((order) => String(order.memberId ?? "")).filter(Boolean),
      );
      const revenue = overviewOrders.reduce(
        (sum, order) => sum + Number(order.totals?.totalAmount ?? 0),
        0,
      );
      setSaleOverview({
        offerCount: offerProductIds.size,
        offerProducerCount: offerProducerIds.size,
        orderCount: overviewOrders.length,
        memberCount: orderingMembers.size,
        revenue,
        averageBasket: overviewOrders.length ? revenue / overviewOrders.length : 0,
      });
    } else {
      setSaleOverview({
        offerCount: 0,
        offerProducerCount: 0,
        orderCount: 0,
        memberCount: 0,
        revenue: 0,
        averageBasket: 0,
      });
    }

    setLoading(false);
  }, [syncRows]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (loading) return;
    if (!targetDistribution?.id) {
      setRows([]);
      return;
    }
    syncRows(targetDistribution.id, producers, membersById, productsByProducer, saleDateKeys).catch(() => undefined);
  }, [targetDistribution?.id, loading, producers, membersById, productsByProducer, saleDateKeys, syncRows]);

  const validatedCount = rows.filter((row) => row.validatedByReferent).length;
  const pendingCount = Math.max(rows.length - validatedCount, 0);
  const targetPotentialProductsCount = useMemo(() => {
    const productIds = new Set<string>();
    rows.forEach((row) => {
      (productsByProducer[row.producerId] ?? []).forEach((product) => {
        productIds.add(product.id);
      });
    });
    return productIds.size;
  }, [rows, productsByProducer]);
  const targetValidatedProductsCount = useMemo(() => {
    const productIds = new Set<string>();
    rows
      .filter((row) => row.validatedByReferent)
      .forEach((row) => {
        (productsByProducer[row.producerId] ?? []).forEach((product) => {
          productIds.add(product.id);
        });
      });
    return productIds.size;
  }, [rows, productsByProducer]);
  const canOpen =
    canManageLifecycle &&
    !openDistribution &&
    Boolean(targetDistribution) &&
    isPlanned(targetDistribution?.status) &&
    rows.length > 0 &&
    validatedCount === rows.length;
  const saleLocked = isOpenStatus(targetDistribution?.status);
  const editingLocked = saleLocked && !isAdmin;

  const groups = useMemo(() => {
    const map: Record<
      string,
      { referentId: string | null; referentName: string; mine: boolean; rows: ProducerRow[] }
    > = {};
    rows.forEach((row) => {
      const key = row.referentId ?? row.referentName;
      if (!map[key]) {
        map[key] = {
          referentId: row.referentId,
          referentName: row.referentName,
          mine: Boolean(row.referentId && row.referentId === effectiveMemberId),
          rows: [],
        };
      }
      map[key].rows.push(row);
    });
    return Object.values(map).sort((a, b) => {
      if (a.mine && !b.mine) return -1;
      if (!a.mine && b.mine) return 1;
      return a.referentName.localeCompare(b.referentName);
    });
  }, [rows, effectiveMemberId]);

  const producersWithoutProducts = useMemo(
    () =>
      producers
        .filter((producer) => (productsByProducer[producer.id] ?? []).length === 0)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [producers, productsByProducer],
  );
  const upcomingPlannedDistributions = useMemo(
    () => plannedDistributions,
    [plannedDistributions],
  );
  const historicalDistributions = useMemo(
    () =>
      distributions
        .filter((distribution) => FINISHED.has(String(distribution.status ?? "").toLowerCase()))
        .sort(
          (left, right) =>
            (toDate(right.dates?.[0]) ?? new Date(0)).getTime() -
            (toDate(left.dates?.[0]) ?? new Date(0)).getTime(),
        ),
    [distributions],
  );
  const showCurrentSection = isOverviewMode || isCurrentMode;
  const showNextSection = isOverviewMode || isNextMode;
  const showValidationSection = isNextMode || (isCurrentMode && isAdmin);
  const showUpcomingSection = isOverviewMode;
  const showHistorySection = isHistoryMode;

  const openFlow = (producerIds: string[], startAt = 0) => {
    if (!targetDistribution?.id) {
      setMessage(
        isCurrentMode
          ? "Aucune vente en cours a modifier."
          : "Aucune distribution planifiee a preparer.",
      );
      return;
    }
    if (editingLocked) {
      setMessage(
        isCurrentMode
          ? "Cette vente en cours est modifiable uniquement par les admins."
          : "Cette distribution est ouverte : preparation reservee aux admins.",
      );
      return;
    }
    if (!producerIds.length) {
      setMessage("Aucun producteur à gérer pour cette vue.");
      return;
    }
    setMessage("");
    const safeIndex = Math.max(0, Math.min(startAt, producerIds.length - 1));
    const idsParam = encodeURIComponent(producerIds.join(","));
    const distributionParam = encodeURIComponent(targetDistribution?.id ?? "");
    router.push(`/admin/vente/gerer?distributionId=${distributionParam}&producerIds=${idsParam}&idx=${safeIndex}`);
  };

  const createDraftVariant = (): VariantDraft => ({
    tempId: newId(),
    label: "Nouvelle variante",
    price: 0,
    activeDates: [...saleDateKeys],
  });

  const createDraftProduct = (): ProductDraft => ({
    id: newId(),
    name: "Nouveau produit",
    description: "",
    imageUrl: "",
    isOrganic: false,
    variants: [createDraftVariant()],
    existingVariantIds: [],
  });

  useEffect(() => {
    if (!flowOpen) return;
    const source = productsByProducer[currentProducerId] ?? [];
    setDraftProducts(
      source.length
        ? source.map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description,
            imageUrl: product.imageUrl,
            isOrganic: product.isOrganic,
            variants: product.variants.map((variant) => ({
              id: variant.id,
              tempId: variant.id,
              label: variant.label,
              price: variant.price,
              activeDates: [...saleDateKeys],
            })),
            existingVariantIds: product.variants.map((variant) => variant.id),
          }))
        : [createDraftProduct()],
    );
  }, [flowOpen, currentProducerId, productsByProducer, saleDateKeys]);

  const updateDraftProduct = (index: number, patch: Partial<ProductDraft>) => {
    setDraftProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const updateDraftVariant = (productIndex: number, variantIndex: number, patch: Partial<VariantDraft>) => {
    setDraftProducts((prev) =>
      prev.map((item, i) => {
        if (i !== productIndex) return item;
        const variants = item.variants.map((variant, vi) =>
          vi === variantIndex ? { ...variant, ...patch } : variant,
        );
        return { ...item, variants };
      }),
    );
  };

  const applyAllDates = (selected: boolean) => {
    setDraftProducts((prev) =>
      prev.map((product) => ({
        ...product,
        variants: product.variants.map((variant) => ({
          ...variant,
          activeDates: selected ? [...saleDateKeys] : [],
        })),
      })),
    );
  };

  const setValidation = async (row: ProducerRow, validated: boolean) => {
    if (!targetDistribution) return;
    setSaving(true);
    await setDoc(
      doc(firebaseDb, "distributionDates", targetDistribution.id, "producers", row.producerId),
      {
        producerId: row.producerId,
        referentId: row.referentId,
        referentName: row.referentName,
        active: validated,
        validatedByReferent: validated,
        validatedAt: validated ? Timestamp.now() : null,
      },
      { merge: true },
    );
    if (isCurrentMode) {
      const offerItemsRef = collection(firebaseDb, "distributionDates", targetDistribution.id, "offerItems");
      const existingOfferSnap = await getDocs(
        query(offerItemsRef, where("producerId", "==", row.producerId)),
      );

      const ops: Array<
        | { type: "delete"; ref: (typeof existingOfferSnap.docs)[number]["ref"] }
        | {
            type: "set";
            ref: ReturnType<typeof doc>;
            data: {
              producerId: string;
              productId: string;
              variantId: string;
              saleDateKey: string;
              title: string;
              variantLabel: string;
              imageUrl: string | null;
              isOrganic: boolean;
              priceApplied: number;
              limitTotal: number;
              active: true;
            };
          }
      > = [];

      existingOfferSnap.docs.forEach((offerDoc) => {
        ops.push({ type: "delete", ref: offerDoc.ref });
      });

      if (validated) {
        (productsByProducer[row.producerId] ?? []).forEach((product) => {
          const limitTotal = Number(product.saleLimit ?? 0);
          product.variants.forEach((variant) => {
            const sourceDates = Array.isArray(variant.activeDates) ? variant.activeDates : [];
            const activeDates = (
              sourceDates.length > 0 ? sourceDates : saleDateKeys
            ).filter((key) => saleDateKeys.includes(key));
            Array.from(new Set(activeDates)).forEach((saleDateKey) => {
              ops.push({
                type: "set",
                ref: doc(offerItemsRef),
                data: {
                  producerId: row.producerId,
                  productId: product.id,
                  variantId: variant.id,
                  saleDateKey,
                  title: product.name,
                  variantLabel: variant.label,
                  imageUrl: product.imageUrl || null,
                  isOrganic: product.isOrganic,
                  priceApplied: Number(variant.price ?? 0),
                  limitTotal: Number.isFinite(limitTotal) && limitTotal > 0 ? limitTotal : 0,
                  active: true,
                },
              });
            });
          });
        });
      }

      const MAX_BATCH_OPS = 380;
      for (let index = 0; index < ops.length; index += MAX_BATCH_OPS) {
        const batch = writeBatch(firebaseDb);
        const chunk = ops.slice(index, index + MAX_BATCH_OPS);
        chunk.forEach((op) => {
          if (op.type === "delete") {
            batch.delete(op.ref);
            return;
          }
          batch.set(op.ref, op.data);
        });
        await batch.commit();
      }
    }
    await load();
    setSaving(false);
  };

  const saveDraft = async () => {
    if (!currentProducerId) return;
    setSaving(true);
    setMessage("");

    for (const product of draftProducts) {
      const payload = {
        producerId: currentProducerId,
        name: product.name.trim() || "Produit",
        description: product.description.trim(),
        imageUrl: product.imageUrl.trim(),
        isOrganic: Boolean(product.isOrganic),
        updatedAt: Timestamp.now(),
      };

      let productId = product.id;
      if (product.id.startsWith("tmp_")) {
        const created = await addDoc(collection(firebaseDb, "products"), payload);
        productId = created.id;
      } else {
        await setDoc(doc(firebaseDb, "products", productId), payload, { merge: true });
      }

      const keptExistingVariantIds = new Set<string>();
      for (const variant of product.variants) {
        const variantPayload = {
          label: variant.label.trim() || "Variante",
          price: Number.isFinite(Number(variant.price)) ? Number(variant.price) : 0,
          activeDates: Array.from(
            new Set(
              (Array.isArray(variant.activeDates) ? variant.activeDates : []).filter((key) =>
                saleDateKeys.includes(key),
              ),
            ),
          ),
        };

        if (variant.id && !variant.id.startsWith("tmp_")) {
          keptExistingVariantIds.add(variant.id);
          await setDoc(doc(firebaseDb, "products", productId, "variants", variant.id), variantPayload, {
            merge: true,
          });
        } else {
          await addDoc(collection(firebaseDb, "products", productId, "variants"), variantPayload);
        }
      }

      for (const existingVariantId of product.existingVariantIds) {
        if (!keptExistingVariantIds.has(existingVariantId)) {
          await deleteDoc(doc(firebaseDb, "products", productId, "variants", existingVariantId));
        }
      }
    }

    await load();
    setSaving(false);
    setMessage("Produits enregistres.");
  };

  const saveAndValidate = async () => {
    await saveDraft();
    if (currentRow) await setValidation(currentRow, true);
  };

  const rebuildOffersForValidatedProducers = async (
    distributionId: string,
    distributionDateKeys: string[],
  ) => {
    const offerItemsRef = collection(firebaseDb, "distributionDates", distributionId, "offerItems");
    const existingOfferSnap = await getDocs(offerItemsRef);
    let batch = writeBatch(firebaseDb);
    let operationCount = 0;
    let offersCreated = 0;
    const producersWithOffers = new Set<string>();

    const flushBatch = async (force = false) => {
      if (!force && operationCount < 380) return;
      if (operationCount === 0) return;
      await batch.commit();
      batch = writeBatch(firebaseDb);
      operationCount = 0;
    };

    existingOfferSnap.docs.forEach((offerDoc) => {
      batch.delete(offerDoc.ref);
      operationCount += 1;
    });
    await flushBatch();

    rows
      .filter((row) => row.validatedByReferent)
      .forEach((row) => {
        const producerId = row.producerId;
        (productsByProducer[producerId] ?? []).forEach((product) => {
          const limitTotal = Number(product.saleLimit ?? 0);
          product.variants.forEach((variant) => {
            const sourceDates = Array.isArray(variant.activeDates) ? variant.activeDates : [];
            const activeDates = (
              sourceDates.length > 0 ? sourceDates : distributionDateKeys
            ).filter((key) => distributionDateKeys.includes(key));
            Array.from(new Set(activeDates)).forEach((saleDateKey) => {
              const offerRef = doc(offerItemsRef);
              batch.set(offerRef, {
                producerId,
                productId: product.id,
                variantId: variant.id,
                saleDateKey,
                title: product.name,
                variantLabel: variant.label,
                imageUrl: product.imageUrl || null,
                isOrganic: product.isOrganic,
                priceApplied: Number(variant.price ?? 0),
                limitTotal: Number.isFinite(limitTotal) && limitTotal > 0 ? limitTotal : 0,
                active: true,
              });
              offersCreated += 1;
              producersWithOffers.add(producerId);
              operationCount += 1;
            });
          });
        });
      });

    await flushBatch(true);
    return { offersCreated, producersWithOffers: producersWithOffers.size };
  };

  const openSale = async () => {
    if (!targetDistribution || !canOpen) return;
    setSaving(true);
    setMessage("");
    try {
      const offerSync = await rebuildOffersForValidatedProducers(targetDistribution.id, saleDateKeys);

      const batch = writeBatch(firebaseDb);
      const firstDate = toDate(targetDistribution.dates?.[0]);
      let closeAt: Timestamp | null = null;
      if (firstDate) {
        const closeDate = new Date(firstDate);
        closeDate.setDate(closeDate.getDate() - 10);
        closeDate.setHours(22, 0, 0, 0);
        closeAt = Timestamp.fromDate(closeDate);
      }
      distributions.forEach((distribution) => {
        if (isOpenStatus(distribution.status) && distribution.id !== targetDistribution.id) {
          batch.update(doc(firebaseDb, "distributionDates", distribution.id), { status: "finished" });
        }
      });
      batch.update(doc(firebaseDb, "distributionDates", targetDistribution.id), {
        status: "open",
        openedAt: Timestamp.now(),
        closeAt,
      });
      await batch.commit();
      await load();
      setMessage(
        `Vente ouverte. ${offerSync.offersCreated} offres publiees pour ${offerSync.producersWithOffers} producteurs.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const closeSale = async () => {
    if (!openDistribution || !canManageLifecycle) return;
    setSaving(true);
    await updateDoc(doc(firebaseDb, "distributionDates", openDistribution.id), {
      status: "finished",
      closedAt: Timestamp.now(),
    });
    await load();
    setSaving(false);
  };

  const goToStep = (nextIndex: number) => {
    setFlowIndex(nextIndex);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (loading) {
    return (
      <div className="rounded-md border border-clay/80 bg-stone p-6 text-sm text-ink/70">
        Chargement des ventes...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {showCurrentSection ? (
      <section className="rounded-md border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Vente en cours</p>
            <h2 className="mt-1 font-serif text-4xl">
              {openDistribution ? distributionLabel(openDistribution) : "Aucune vente ouverte"}
            </h2>
            <p className="mt-2 text-sm text-ink/70">
              {openDistribution
                ? `Ouverte le ${formatLongDate(toDate(openDistribution.openedAt))}${toDate(openDistribution.closeAt) ? ` - fermeture auto le ${formatLongDate(toDate(openDistribution.closeAt))} a 22h` : ""}.`
                : "La boutique est actuellement fermee."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {openDistributionDates.length ? (
                openDistributionDates.map((label, index) => (
                  <span
                    key={`open-date-${index}`}
                    className="rounded-full border border-forest/30 bg-forest/10 px-3 py-1 text-xs font-semibold text-forest"
                  >{label}</span>
                ))
              ) : (
                <span className="rounded-full border border-ink/20 bg-ink/5 px-3 py-1 text-xs text-ink/70">Dates de distribution non renseignees</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {canManageLifecycle && openDistribution ? (
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold"
                onClick={closeSale}
                disabled={saving}
              >
                Fermer la vente
              </button>
            ) : null}
            {canManageLifecycle && !openDistribution ? (
              <button
                className="rounded-md bg-forest px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={openSale}
                disabled={saving || !canOpen}
              >
                Ouvrir la vente
              </button>
            ) : null}
            {isCurrentMode && isAdmin && openDistribution ? (
              <button
                className="rounded-md bg-forest px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => openFlow(rows.map((row) => row.producerId))}
                disabled={saving || editingLocked || rows.length === 0}
              >
                Modifier la vente en cours
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
            Produits: <span className="font-semibold">{saleOverview.offerCount}</span>
          </div>
          <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
            Producteurs: <span className="font-semibold">{saleOverview.offerProducerCount}</span>
          </div>
          <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
            Commandes: <span className="font-semibold">{saleOverview.orderCount}</span>
          </div>
          <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
            Adhérents: <span className="font-semibold">{saleOverview.memberCount}</span>
          </div>
          <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
            CA: <span className="font-semibold">{money(saleOverview.revenue)} EUR</span>
          </div>
          <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
            Panier moyen: <span className="font-semibold">{money(saleOverview.averageBasket)} EUR</span>
          </div>
        </div>

        {canManageLifecycle && !openDistribution && !canOpen ? (
          <p className="mt-3 text-sm text-ink/70">
            Pour ouvrir la vente, valide tous les producteurs de la prochaine distribution.
          </p>
        ) : null}
      </section>
      ) : null}

      {showHistorySection ? (
        <section className="rounded-md border border-ink/20 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Historique des ventes</p>
              <h3 className="mt-1 font-serif text-3xl">Ventes passees</h3>
            </div>
            <p className="text-xs text-ink/65">
              {historicalDistributions.length} vente(s) cloturee(s)
            </p>
          </div>

          {historicalDistributions.length > 0 ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {historicalDistributions.map((distribution) => {
                const metrics = distributionMetrics[distribution.id];
                const dateLabels = distributionDateBadges(distribution);
                return (
                  <article key={distribution.id} className="rounded-sm border border-clay/70 bg-stone p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{distributionLabel(distribution)}</p>
                      <span className="rounded-sm border border-ink/25 bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink/80">
                        Cloturee
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dateLabels.length ? (
                        dateLabels.map((label, index) => (
                          <span key={`${distribution.id}-history-date-${index}`} className="rounded-full border border-clay/60 bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-ink/80">
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink/65">Dates non renseignees</span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                        Producteurs: <span className="font-semibold">{metrics?.producersActive ?? 0}</span>
                      </div>
                      <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                        Valides: <span className="font-semibold">{metrics?.producersValidated ?? 0}</span>
                      </div>
                      <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                        Produits: <span className="font-semibold">{metrics?.productsCount ?? 0}</span>
                      </div>
                      <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                        Commandes: <span className="font-semibold">{metrics?.ordersCount ?? 0}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink/70">Aucune vente cloturee pour le moment.</p>
          )}
        </section>
      ) : null}
      {showNextSection ? (
      <section className="rounded-md border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Prochaine vente</p>
            <h3 className="mt-1 font-serif text-3xl">Preparation de la prochaine distribution</h3>
            <p className="mt-1 text-sm text-ink/70">
              {nextPlannedDistribution
                ? `${distributionLabel(nextPlannedDistribution)}`
                : "Aucune prochaine vente planifiee."}
            </p>
            {nextPlannedDistribution ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {nextDistributionDates.map((label, index) => (
                  <span
                    key={`next-date-${index}`}
                    className="rounded-full border border-honey/45 bg-honey/20 px-3 py-1 text-xs font-semibold text-ink/85"
                  >{label}</span>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-xs text-ink/60">
              Tu peux preparer et pre-valider cette prochaine vente. Les effets boutique deviennent visibles uniquement quand elle est ouverte.
            </p>
          </div>
          <div className="flex gap-2">
            {!openDistribution && canManageLifecycle && nextPlannedDistribution ? (
              <button
                className="rounded-md bg-forest px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={openSale}
                disabled={saving || !canOpen}
              >
                Ouvrir cette vente
              </button>
            ) : null}
            {openDistribution ? (
              <span className="rounded-sm border border-ink/20 bg-ink/5 px-3 py-2 text-xs text-ink/70">
                Ferme la vente en cours avant d'ouvrir celle-ci.
              </span>
            ) : null}
          </div>
        </div>

        {nextPlannedDistribution ? (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
              Producteurs inclus:{" "}
              <span className="font-semibold">{rows.length}</span>
            </div>
            <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
              Producteurs valides:{" "}
              <span className="font-semibold">{validatedCount}</span>
            </div>
            <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
              Produits valides:{" "}
              <span className="font-semibold">{targetValidatedProductsCount}</span>
            </div>
            <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
              Produits potentiels:{" "}
              <span className="font-semibold">{targetPotentialProductsCount}</span>
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {showValidationSection ? (
      <section className="rounded-md border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
              {isCurrentMode ? "Vente en cours" : "Validation referents"}
            </p>
            <h3 className="mt-1 font-serif text-3xl">
              {isCurrentMode ? "Modifier la vente en cours" : "Producteurs a valider"}
            </h3>
            <p className="mt-1 text-sm text-ink/70">
              {isCurrentMode
                ? "Modification en direct de la vente ouverte (admin uniquement)."
                : "Seuls les producteurs avec produits apparaissent dans le tableau."}
            </p>
            <p className="mt-2 text-sm font-semibold text-ink/85">
              Validation pour:{" "}
              <span className="text-ink">
                {targetDistribution ? distributionLabel(targetDistribution) : "Aucune distribution ciblee"}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {targetDistributionDates.length ? (
                targetDistributionDates.map((label, index) => (
                  <span
                    key={`validation-date-${index}`}
                    className="rounded-full border border-clay/70 bg-stone px-3 py-1 text-xs font-semibold text-ink/80"
                  >{label}</span>
                ))
              ) : (
                <span className="rounded-full border border-ink/20 bg-ink/5 px-3 py-1 text-xs text-ink/70">Dates non renseignees</span>
              )}
            </div>
            {editingLocked ? (
              <p className="mt-1 text-xs text-ember">
                Cette distribution est ouverte : validations et editions reservees aux admins.
              </p>
            ) : saleLocked ? (
              <p className="mt-1 text-xs text-moss">
                Vente ouverte : modifications autorisees (admin).
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isCurrentMode && isReferent ? (
              <button
                className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() =>
                  openFlow(rows.filter((row) => row.referentId === effectiveMemberId).map((row) => row.producerId))
                }
                disabled={editingLocked}
              >
                Gerer mes producteurs pour la vente
              </button>
            ) : null}
            {(isCurrentMode ? isAdmin : canManageAdmin) ? (
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => openFlow(rows.map((row) => row.producerId))}
                disabled={editingLocked}
              >
                {isCurrentMode ? "Modifier les producteurs de la vente" : "Gerer tous les producteurs"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
            Producteurs total : <span className="font-semibold">{rows.length}</span>
          </div>
          <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
            Producteurs valides : <span className="font-semibold">{validatedCount}</span>
          </div>
          <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
            Producteurs a valider : <span className="font-semibold">{pendingCount}</span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border border-ink/20">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-ink/20 bg-ink text-xs uppercase tracking-[0.18em] text-stone">
              <tr>
                <th className="px-3 py-2">Référent</th>
                <th className="px-3 py-2">Producteur</th>
                <th className="px-3 py-2">Produits</th>
                <th className="px-3 py-2">Validation</th>
                <th className="px-3 py-2">Date validation</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.rows.map((row, index) => {
                  const canEdit = (isCurrentMode ? isAdmin : canManageAdmin) && !editingLocked;
                  const myProducerIds = rows
                    .filter((item) => item.referentId === effectiveMemberId)
                    .map((item) => item.producerId);
                  return (
                    <tr key={row.producerId} className={`border-b border-ink/10 ${group.mine ? "bg-forest/10" : "bg-white"}`}>
                      <td className="px-3 py-2 text-xs text-ink/70">{index === 0 ? group.referentName : null}</td>
                      <td className="px-3 py-2 font-semibold text-ink">{row.producerName}</td>
                      <td className="px-3 py-2 text-xs text-ink/70">{row.productCount}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-sm px-2 py-1 text-xs font-semibold ${
                            row.validatedByReferent
                              ? "border border-forest/40 bg-forest/15 text-forest"
                              : "border border-ink/20 bg-ink/5 text-ink/70"
                          }`}
                        >
                          {row.validatedByReferent ? "Validé" : "À valider"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink/60">{row.validatedAtLabel}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                            onClick={() => openFlow([row.producerId])}
                            disabled={editingLocked}
                          >
                            Gérer
                          </button>
                          {isReferent && row.referentId === effectiveMemberId ? (
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                              onClick={() =>
                                openFlow(
                                  myProducerIds,
                                  myProducerIds.findIndex((id) => id === row.producerId),
                                )
                              }
                              disabled={editingLocked}
                            >
                              Gérer tous mes producteurs
                            </button>
                          ) : null}
                          {canEdit ? (
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                              onClick={() => setValidation(row, !row.validatedByReferent).catch(() => undefined)}
                            >
                              {row.validatedByReferent ? "Retirer validation" : "Valider"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>

        {!isCurrentMode && producersWithoutProducts.length > 0 ? (
          <div className="mt-4 border border-dashed border-ink/25 bg-ink/5 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/55">
              Producteurs sans produits ({producersWithoutProducts.length})
            </p>
            <p className="mt-1 text-xs text-ink/55">
              Ces producteurs existent, mais ne sont pas inclus dans la validation de vente.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {producersWithoutProducts.map((producer) => (
                <span
                  key={producer.id}
                  className="rounded-sm border border-ink/20 bg-stone px-2 py-1 text-xs text-ink/65"
                >
                  {producer.name ?? "Producteur"}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {showUpcomingSection ? (
      <section className="rounded-md border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Ventes a venir</p>
            <h3 className="mt-1 font-serif text-3xl">Recap des prochaines distributions</h3>
          </div>
          <p className="text-xs text-ink/65">
            {upcomingPlannedDistributions.length} distribution(s) planifiee(s)
          </p>
        </div>

        {upcomingPlannedDistributions.length > 0 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {upcomingPlannedDistributions.map((distribution) => {
              const metrics = distributionMetrics[distribution.id];
              const dateLabels = distributionDateBadges(distribution);
              return (
                <article key={distribution.id} className="rounded-sm border border-clay/70 bg-stone p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{distributionLabel(distribution)}</p>
                    <span className="rounded-sm border border-honey/40 bg-honey/15 px-2 py-0.5 text-[11px] font-semibold text-ink/80">
                      Planifiee
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {dateLabels.length ? (
                      dateLabels.map((label, index) => (
                        <span key={`${distribution.id}-date-${index}`} className="rounded-full border border-clay/60 bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-ink/80">
                          {label}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-ink/65">📅 Dates non renseignées</span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                      Producteurs: <span className="font-semibold">{metrics?.producersActive ?? 0}</span>
                    </div>
                    <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                      Valides: <span className="font-semibold">{metrics?.producersValidated ?? 0}</span>
                    </div>
                    <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                      Produits: <span className="font-semibold">{metrics?.productsCount ?? 0}</span>
                    </div>
                    <div className="rounded-sm border border-clay/70 bg-white px-2 py-1">
                      Commandes: <span className="font-semibold">{metrics?.ordersCount ?? 0}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink/70">Aucune distribution planifiee.</p>
        )}
      </section>
      ) : null}

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {flowOpen ? (
        <section className="rounded-md border border-ink/20 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/20 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Gerer mes producteurs pour la vente
              </p>
              <h4 className="mt-1 font-serif text-2xl">{currentProducer?.name ?? "Producteur"}</h4>
              <p className="text-sm text-ink/70">
                Producteur {flowIndex + 1} / {flowProducerIds.length}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => applyAllDates(true)}
              >
                Tout selectionner
              </button>
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => applyAllDates(false)}
              >
                Tout deselectionner
              </button>
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => setDraftProducts((prev) => [...prev, createDraftProduct()])}
              >
                Ajouter un produit
              </button>
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => setFlowOpen(false)}
              >
                Fermer edition
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {draftProducts.map((product, pIndex) => (
              <div key={`${product.id}-${pIndex}`} className="border border-ink/20 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="min-w-[280px] flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                    Nom produit
                    <input
                      className="mt-1 w-full rounded-sm border border-ink/20 bg-stone px-3 py-2 text-sm"
                      value={product.name}
                      onChange={(e) => updateDraftProduct(pIndex, { name: e.target.value })}
                    />
                  </label>
                  {product.id.startsWith("tmp_") ? (
                    <span className="text-xs text-ink/60">Enregistrer pour editer les details</span>
                  ) : (
                    <button
                      className="rounded-md border border-ink/25 px-3 py-2 text-xs font-semibold"
                      onClick={() =>
                        router.push(
                          `/admin/vente/produit/${product.id}?distributionId=${targetDistribution?.id ?? ""}&producerId=${currentProducerId}`,
                        )
                      }
                    >
                      Ouvrir details produit
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-ink/20">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b border-ink/20 bg-ink text-xs uppercase tracking-[0.12em] text-stone">
                      <tr>
                        <th className="px-2 py-2 text-left">Variante</th>
                        <th className="px-2 py-2 text-left">Prix</th>
                        {saleDates.map((date) => (
                          <th key={date.key} className="px-2 py-2 text-center">
                            {date.label}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.variants.map((variant, vIndex) => (
                        <tr key={variant.tempId} className="border-b border-ink/10">
                          <td className="px-2 py-2">
                            <input
                              className="w-full rounded-sm border border-ink/20 bg-stone px-2 py-1"
                              value={variant.label}
                              onChange={(e) => updateDraftVariant(pIndex, vIndex, { label: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="relative">
                              <input
                                className="w-full rounded-sm border border-ink/20 bg-stone px-2 py-1 pr-12"
                                type="number"
                                min={0}
                                step="0.01"
                                value={String(variant.price)}
                                onChange={(e) =>
                                  updateDraftVariant(pIndex, vIndex, { price: Number(e.target.value || 0) })
                                }
                              />
                              <span className="pointer-events-none absolute right-2 top-1 text-xs text-ink/55">
                                &euro;
                              </span>
                            </div>
                          </td>
                          {saleDates.map((date) => (
                            <td key={date.key} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={variant.activeDates.includes(date.key)}
                                onChange={() => {
                                  const current = variant.activeDates;
                                  const next = current.includes(date.key)
                                    ? current.filter((key) => key !== date.key)
                                    : [...current, date.key];
                                  updateDraftVariant(pIndex, vIndex, { activeDates: next });
                                }}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right">
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                              onClick={() =>
                                updateDraftProduct(pIndex, {
                                  variants: product.variants.filter((_, idx) => idx !== vIndex),
                                })
                              }
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <button
                    className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                    onClick={() =>
                      updateDraftProduct(pIndex, {
                        variants: [...product.variants, createDraftVariant()],
                      })
                    }
                  >
                    Ajouter une variante
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink/20 pt-4">
            <div className="flex gap-2">
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                disabled={flowIndex <= 0}
                onClick={() => goToStep(Math.max(flowIndex - 1, 0))}
              >
                Precedent
              </button>
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                disabled={flowIndex >= flowProducerIds.length - 1}
                onClick={() => goToStep(Math.min(flowIndex + 1, flowProducerIds.length - 1))}
              >
                Suivant
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold"
                onClick={saveDraft}
                disabled={saving}
              >
                Enregistrer ce producteur
              </button>
              <button
                className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={saveAndValidate}
                disabled={saving || !currentRow}
              >
                Enregistrer et valider
              </button>
            </div>
          </div>

        </section>
      ) : null}
    </div>
  );
}


