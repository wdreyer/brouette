
import { Timestamp, collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { firebaseDb } from "./client";

type BatchItem = {
  refPath: string[];
  data: Record<string, unknown>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function docRefFromPath(path: [string, ...string[]]) {
  const [first, ...rest] = path;
  return doc(firebaseDb, first, ...rest);
}

export async function seedDatabase() {
  const now = new Date();
  const t = (iso: string) => Timestamp.fromDate(new Date(iso));

  const members = [
    {
      id: "m1",
      firstName: "Lea",
      lastName: "Martin",
      email: "lea.martin@example.com",
      phone: "0612345678",
      address: { street: "12 rue des Lilas", postalCode: "35000", city: "Rennes" },
      membershipStatus: "active",
      membership: {
        startDate: t("2024-01-15"),
        endDate: t("2026-01-15"),
        paymentMode: "card",
        internalNote: "Renouvellement auto.",
      },
      auth: { uid: "uid_m1", role: "member" },
    },
    {
      id: "m2",
      firstName: "Nora",
      lastName: "Dupont",
      email: "nora.dupont@example.com",
      phone: "0623456789",
      address: { street: "5 impasse du Port", postalCode: "44000", city: "Nantes" },
      membershipStatus: "active",
      membership: {
        startDate: t("2023-09-01"),
        endDate: t("2026-09-01"),
        paymentMode: "transfer",
        internalNote: "Payee pour 3 ans.",
      },
      auth: { uid: "uid_m2", role: "member" },
    },
    {
      id: "m3",
      firstName: "Hugo",
      lastName: "Bernard",
      email: "hugo.bernard@example.com",
      phone: "0634567890",
      address: { street: "18 avenue Pasteur", postalCode: "75014", city: "Paris" },
      membershipStatus: "inactive",
      membership: {
        startDate: t("2022-02-10"),
        endDate: t("2023-02-10"),
        paymentMode: "cash",
        internalNote: "A suspendu son adhesion.",
      },
      auth: { uid: "uid_m3", role: "member" },
    },
    {
      id: "m4",
      firstName: "Camille",
      lastName: "Roche",
      email: "camille.roche@example.com",
      phone: "0645678901",
      address: { street: "22 rue des Roses", postalCode: "33000", city: "Bordeaux" },
      membershipStatus: "active",
      membership: {
        startDate: t("2024-05-01"),
        endDate: t("2025-05-01"),
        paymentMode: "card",
        internalNote: "Aime les paniers legumes.",
      },
      auth: { uid: "uid_m4", role: "member" },
    },
    {
      id: "m5",
      firstName: "Louis",
      lastName: "Giraud",
      email: "louis.giraud@example.com",
      phone: "0656789012",
      address: { street: "7 rue Victor Hugo", postalCode: "67000", city: "Strasbourg" },
      membershipStatus: "active",
      membership: {
        startDate: t("2025-01-10"),
        endDate: t("2026-01-10"),
        paymentMode: "check",
        internalNote: "Cheque depose.",
      },
      auth: { uid: "uid_m5", role: "member" },
    },
    {
      id: "m6",
      firstName: "Emma",
      lastName: "Leroy",
      email: "emma.leroy@example.com",
      phone: "0667890123",
      address: { street: "3 rue des Vignes", postalCode: "21000", city: "Dijon" },
      membershipStatus: "inactive",
      membership: {
        startDate: t("2021-06-05"),
        endDate: t("2022-06-05"),
        paymentMode: "card",
        internalNote: "Plus a jour.",
      },
      auth: { uid: "uid_m6", role: "member" },
    },
    {
      id: "m7",
      firstName: "Noah",
      lastName: "Fournier",
      email: "noah.fournier@example.com",
      phone: "0678901234",
      address: { street: "14 rue des Artisans", postalCode: "59000", city: "Lille" },
      membershipStatus: "active",
      membership: {
        startDate: t("2024-11-01"),
        endDate: t("2025-11-01"),
        paymentMode: "transfer",
        internalNote: "Nouveau membre.",
      },
      auth: { uid: "uid_m7", role: "member" },
    },
    {
      id: "m8",
      firstName: "Jules",
      lastName: "Morel",
      email: "jules.morel@example.com",
      phone: "0689012345",
      address: { street: "9 avenue des Fleurs", postalCode: "13008", city: "Marseille" },
      membershipStatus: "active",
      membership: {
        startDate: t("2023-03-20"),
        endDate: t("2026-03-20"),
        paymentMode: "card",
        internalNote: "Participe aux permanences.",
      },
      auth: { uid: "uid_m8", role: "admin" },
    },
    {
      id: "m9",
      firstName: "Zoe",
      lastName: "Petit",
      email: "zoe.petit@example.com",
      phone: "0690123456",
      address: { street: "41 rue du Moulin", postalCode: "54000", city: "Nancy" },
      membershipStatus: "active",
      membership: {
        startDate: t("2024-02-01"),
        endDate: t("2025-02-01"),
        paymentMode: "card",
        internalNote: "RAS.",
      },
      auth: { uid: "uid_m9", role: "member" },
    },
    {
      id: "m10",
      firstName: "Nina",
      lastName: "Lopez",
      email: "nina.lopez@example.com",
      phone: "0601020304",
      address: { street: "2 place de la Republique", postalCode: "69002", city: "Lyon" },
      membershipStatus: "inactive",
      membership: {
        startDate: t("2022-10-12"),
        endDate: t("2023-10-12"),
        paymentMode: "cash",
        internalNote: "Reinscription possible.",
      },
      auth: { uid: "uid_m10", role: "member" },
    },
  ];
  const producers = [
    {
      id: "p1",
      name: "Ferme des Collines",
      contact: { firstName: "Marc", lastName: "Durand" },
      email: "contact@collines.example.com",
      phone: "0211223344",
      address: { street: "1 chemin des Pres", postalCode: "35600", city: "Redon" },
      coopStatus: "active",
      notes: "Legumes racines.",
    },
    {
      id: "p2",
      name: "Les Jardins du Sud",
      contact: { firstName: "Alice", lastName: "Vidal" },
      email: "alice@jardins-sud.example.com",
      phone: "0411223344",
      address: { street: "10 route du Lac", postalCode: "34000", city: "Montpellier" },
      coopStatus: "active",
      notes: "Fruits d'ete.",
    },
    {
      id: "p3",
      name: "GAEC des Ruches",
      contact: { firstName: "Paul", lastName: "Renard" },
      email: "paul@ruches.example.com",
      phone: "0311223344",
      address: { street: "6 rue des Abeilles", postalCode: "37000", city: "Tours" },
      coopStatus: "active",
      notes: "Miel et derives.",
    },
    {
      id: "p4",
      name: "Domaine du Verger",
      contact: { firstName: "Claire", lastName: "Petit" },
      email: "claire@verger.example.com",
      phone: "0511223344",
      address: { street: "8 allee des Pommiers", postalCode: "49200", city: "Angers" },
      coopStatus: "active",
      notes: "Pommes et poires.",
    },
    {
      id: "p5",
      name: "La Bergerie",
      contact: { firstName: "Olivier", lastName: "Lemoine" },
      email: "olivier@bergerie.example.com",
      phone: "0711223344",
      address: { street: "4 chemin des Paturages", postalCode: "09000", city: "Foix" },
      coopStatus: "inactive",
      notes: "En pause saisonniere.",
    },
    {
      id: "p6",
      name: "Ferme des Quatre Saisons",
      contact: { firstName: "Julie", lastName: "Marchand" },
      email: "julie@4saisons.example.com",
      phone: "0611223344",
      address: { street: "15 route du Marche", postalCode: "45000", city: "Orleans" },
      coopStatus: "active",
      notes: "Panier mixte.",
    },
    {
      id: "p7",
      name: "Fromagerie de la Riviere",
      contact: { firstName: "Etienne", lastName: "Bailly" },
      email: "etienne@fromagerie.example.com",
      phone: "0211334455",
      address: { street: "3 rue du Lait", postalCode: "50000", city: "Saint-Lo" },
      coopStatus: "active",
      notes: "Fromages au lait cru.",
    },
    {
      id: "p8",
      name: "Les Poules Heureuses",
      contact: { firstName: "Sophie", lastName: "Gaudin" },
      email: "sophie@poules.example.com",
      phone: "0311334455",
      address: { street: "2 chemin des Granges", postalCode: "72000", city: "Le Mans" },
      coopStatus: "active",
      notes: "Oeufs plein air.",
    },
    {
      id: "p9",
      name: "La Ferme Bleue",
      contact: { firstName: "Romain", lastName: "Colin" },
      email: "romain@fermebleue.example.com",
      phone: "0411334455",
      address: { street: "12 route du Bois", postalCode: "25000", city: "Besancon" },
      coopStatus: "active",
      notes: "Herbes aromatiques.",
    },
    {
      id: "p10",
      name: "Maraichage du Nord",
      contact: { firstName: "Helene", lastName: "Fontaine" },
      email: "helene@nord.example.com",
      phone: "0511334455",
      address: { street: "9 avenue des Champs", postalCode: "59100", city: "Roubaix" },
      coopStatus: "inactive",
      notes: "Plus partenaire.",
    },
  ];

  let products = [
    {
      id: "pr1",
      producerId: "p4",
      name: "Pommes",
      description: "Pommes croquantes de saison.",
      imageUrl: "/images/pommes.jpg",
      isOrganic: true,
      status: "active",
      tags: ["fruit"],
      variants: [
        { id: "v1", label: "1kg", type: "Golden", unit: "kg", price: 3.5, status: "active" },
        { id: "v2", label: "2kg", type: "Golden", unit: "kg", price: 6.5, status: "active" },
      ],
    },
    {
      id: "pr2",
      producerId: "p1",
      name: "Pommes de terre",
      description: "Pommes de terre farineuses.",
      imageUrl: "/images/pdt.jpg",
      isOrganic: true,
      status: "active",
      tags: ["legume"],
      variants: [
        { id: "v1", label: "2kg", type: "Monalisa", unit: "kg", price: 4.2, status: "active" },
        { id: "v2", label: "5kg", type: "Monalisa", unit: "kg", price: 9.5, status: "active" },
      ],
    },
    {
      id: "pr3",
      producerId: "p8",
      name: "Oeufs",
      description: "Oeufs plein air calibre M.",
      imageUrl: "/images/oeufs.jpg",
      isOrganic: false,
      status: "active",
      tags: ["oeufs"],
      variants: [
        { id: "v1", label: "Boite de 6", type: "M", unit: "boite", price: 3.2, status: "active" },
        { id: "v2", label: "Boite de 12", type: "M", unit: "boite", price: 5.9, status: "active" },
      ],
    },
    {
      id: "pr4",
      producerId: "p7",
      name: "Fromage de chevre",
      description: "Fromage frais affine.",
      imageUrl: "/images/chevre.jpg",
      isOrganic: true,
      status: "active",
      tags: ["fromage"],
      variants: [
        { id: "v1", label: "120g", type: "Frais", unit: "piece", price: 2.8, status: "active" },
        { id: "v2", label: "180g", type: "Affinee", unit: "piece", price: 3.6, status: "active" },
      ],
    },
    {
      id: "pr5",
      producerId: "p2",
      name: "Tomates",
      description: "Tomates rondes bien mures.",
      imageUrl: "/images/tomates.jpg",
      isOrganic: true,
      status: "active",
      tags: ["legume", "ete"],
      variants: [
        { id: "v1", label: "1kg", type: "Ronde", unit: "kg", price: 4.8, status: "active" },
        { id: "v2", label: "2kg", type: "Ronde", unit: "kg", price: 8.9, status: "active" },
      ],
    },
    {
      id: "pr6",
      producerId: "p3",
      name: "Miel",
      description: "Miel toutes fleurs.",
      imageUrl: "/images/miel.jpg",
      isOrganic: true,
      status: "active",
      tags: ["miel"],
      variants: [
        { id: "v1", label: "250g", type: "Toutes fleurs", unit: "pot", price: 5.0, status: "active" },
        { id: "v2", label: "500g", type: "Toutes fleurs", unit: "pot", price: 9.0, status: "active" },
      ],
    },
    {
      id: "pr7",
      producerId: "p6",
      name: "Carottes",
      description: "Carottes nouvelles.",
      imageUrl: "/images/carottes.jpg",
      isOrganic: false,
      status: "active",
      tags: ["legume"],
      variants: [
        { id: "v1", label: "1kg", type: "Nantaise", unit: "kg", price: 3.1, status: "active" },
        { id: "v2", label: "2kg", type: "Nantaise", unit: "kg", price: 5.8, status: "active" },
      ],
    },
    {
      id: "pr8",
      producerId: "p9",
      name: "Basilic",
      description: "Bottes de basilic frais.",
      imageUrl: "/images/basilic.jpg",
      isOrganic: true,
      status: "active",
      tags: ["herbes"],
      variants: [
        { id: "v1", label: "Botte", type: "Vert", unit: "botte", price: 2.2, status: "active" },
        { id: "v2", label: "2 bottes", type: "Vert", unit: "botte", price: 4.0, status: "active" },
      ],
    },
    {
      id: "pr9",
      producerId: "p1",
      name: "Poireaux",
      description: "Poireaux d'hiver.",
      imageUrl: "/images/poireaux.jpg",
      isOrganic: true,
      status: "inactive",
      tags: ["legume", "hiver"],
      variants: [
        { id: "v1", label: "1kg", type: "Long", unit: "kg", price: 2.9, status: "inactive" },
        { id: "v2", label: "2kg", type: "Long", unit: "kg", price: 5.4, status: "inactive" },
      ],
    },
    {
      id: "pr10",
      producerId: "p5",
      name: "Yaourt fermier",
      description: "Yaourt nature ferme.",
      imageUrl: "/images/yaourt.jpg",
      isOrganic: false,
      status: "inactive",
      tags: ["laitier"],
      variants: [
        { id: "v1", label: "2x125g", type: "Nature", unit: "lot", price: 2.5, status: "inactive" },
        { id: "v2", label: "4x125g", type: "Nature", unit: "lot", price: 4.6, status: "inactive" },
      ],
    },
  ];
  const distributions = [
    {
      id: "d1",
      dates: [t("2026-02-06T18:00:00.000Z"), t("2026-02-20T18:00:00.000Z"), t("2026-03-06T18:00:00.000Z")],
      status: "planned",
    },
    {
      id: "d2",
      dates: [t("2026-03-20T18:00:00.000Z"), t("2026-04-03T18:00:00.000Z"), t("2026-04-17T18:00:00.000Z")],
      status: "open",
    },
    {
      id: "d3",
      dates: [t("2026-05-01T18:00:00.000Z"), t("2026-05-15T18:00:00.000Z"), t("2026-05-29T18:00:00.000Z")],
      status: "finished",
    },
  ];

  const periodDates = distributions.map((dist) => dist.dates);
  const productSaleMap: Record<string, number[]> = {
    pr1: [0],
    pr2: [0, 1],
    pr3: [0],
    pr4: [1],
    pr5: [0, 1],
    pr6: [1],
    pr7: [2],
    pr8: [2],
    pr9: [1],
    pr10: [2],
  };

  products = products.map((product) => {
    const indexes = productSaleMap[product.id] ?? [0];
    const saleDates = indexes.flatMap((index) => periodDates[index] ?? []);
    return { ...product, saleDates };
  });

  const documents = [
    {
      id: "doc1",
      type: "producer-order",
      distributionId: "d1",
      producerId: "p1",
      storagePath: "pdfs/d1/p1-commande.pdf",
      generatedAt: t("2026-02-05T09:00:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc2",
      type: "producer-order",
      distributionId: "d1",
      producerId: "p4",
      storagePath: "pdfs/d1/p4-commande.pdf",
      generatedAt: t("2026-02-05T09:05:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc3",
      type: "distribution-sheet",
      distributionId: "d1",
      producerId: null,
      storagePath: "pdfs/d1/fiche-distribution.pdf",
      generatedAt: t("2026-02-05T09:10:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc4",
      type: "producer-order",
      distributionId: "d2",
      producerId: "p2",
      storagePath: "pdfs/d2/p2-commande.pdf",
      generatedAt: t("2026-02-19T09:00:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc5",
      type: "distribution-sheet",
      distributionId: "d2",
      producerId: null,
      storagePath: "pdfs/d2/fiche-distribution.pdf",
      generatedAt: t("2026-02-19T09:10:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc6",
      type: "producer-order",
      distributionId: "d3",
      producerId: "p3",
      storagePath: "pdfs/d3/p3-commande.pdf",
      generatedAt: t("2026-03-05T09:00:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc7",
      type: "distribution-sheet",
      distributionId: "d3",
      producerId: null,
      storagePath: "pdfs/d3/fiche-distribution.pdf",
      generatedAt: t("2026-03-05T09:10:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc8",
      type: "producer-order",
      distributionId: "d4",
      producerId: "p7",
      storagePath: "pdfs/d4/p7-commande.pdf",
      generatedAt: t("2026-03-19T09:00:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc9",
      type: "distribution-sheet",
      distributionId: "d4",
      producerId: null,
      storagePath: "pdfs/d4/fiche-distribution.pdf",
      generatedAt: t("2026-03-19T09:10:00.000Z"),
      generatedBy: "uid_m8",
    },
    {
      id: "doc10",
      type: "distribution-sheet",
      distributionId: "d5",
      producerId: null,
      storagePath: "pdfs/d5/fiche-distribution.pdf",
      generatedAt: t("2026-04-02T09:10:00.000Z"),
      generatedBy: "uid_m8",
    },
  ];

  const messages = [
    {
      id: "msg1",
      target: "all-members",
      distributionId: "d1",
      subject: "Ouverture boutique d1",
      content: "La boutique est ouverte pour la distribution d1.",
      status: "sent",
      stats: { recipients: 58, sentAt: t("2026-01-25T09:00:00.000Z") },
    },
    {
      id: "msg2",
      target: "ordered-members",
      distributionId: "d1",
      subject: "Rappel retrait",
      content: "Pensez au retrait vendredi.",
      status: "sent",
      stats: { recipients: 41, sentAt: t("2026-02-05T09:00:00.000Z") },
    },
    {
      id: "msg3",
      target: "all-members",
      distributionId: "d2",
      subject: "Ouverture boutique d2",
      content: "La boutique est ouverte pour la distribution d2.",
      status: "sent",
      stats: { recipients: 60, sentAt: t("2026-02-08T09:00:00.000Z") },
    },
    {
      id: "msg4",
      target: "ordered-members",
      distributionId: "d2",
      subject: "Rappel retrait d2",
      content: "Pensez au retrait vendredi.",
      status: "sent",
      stats: { recipients: 43, sentAt: t("2026-02-19T09:00:00.000Z") },
    },
    {
      id: "msg5",
      target: "all-members",
      distributionId: "d3",
      subject: "Ouverture boutique d3",
      content: "La boutique est ouverte pour la distribution d3.",
      status: "sent",
      stats: { recipients: 62, sentAt: t("2026-02-22T09:00:00.000Z") },
    },
    {
      id: "msg6",
      target: "ordered-members",
      distributionId: "d3",
      subject: "Rappel retrait d3",
      content: "Pensez au retrait vendredi.",
      status: "sent",
      stats: { recipients: 46, sentAt: t("2026-03-05T09:00:00.000Z") },
    },
    {
      id: "msg7",
      target: "all-members",
      distributionId: "d4",
      subject: "Ouverture boutique d4",
      content: "La boutique est ouverte pour la distribution d4.",
      status: "sent",
      stats: { recipients: 59, sentAt: t("2026-03-08T09:00:00.000Z") },
    },
    {
      id: "msg8",
      target: "ordered-members",
      distributionId: "d4",
      subject: "Rappel retrait d4",
      content: "Pensez au retrait vendredi.",
      status: "sent",
      stats: { recipients: 44, sentAt: t("2026-03-19T09:00:00.000Z") },
    },
    {
      id: "msg9",
      target: "all-members",
      distributionId: "d5",
      subject: "Ouverture boutique d5",
      content: "La boutique est ouverte pour la distribution d5.",
      status: "sent",
      stats: { recipients: 63, sentAt: t("2026-03-22T09:00:00.000Z") },
    },
    {
      id: "msg10",
      target: "ordered-members",
      distributionId: "d5",
      subject: "Rappel retrait d5",
      content: "Pensez au retrait vendredi.",
      status: "sent",
      stats: { recipients: 47, sentAt: t("2026-04-02T09:00:00.000Z") },
    },
  ];

  const settings = {
    id: "defaults",
    texts: {
      welcome: "Bienvenue a la cooperative.",
      footer: "Merci de soutenir les producteurs.",
    },
    emailTemplates: {
      orderConfirmation: "Merci pour votre commande.",
      pickupReminder: "N'oubliez pas votre retrait.",
    },
    rules: {
      defaultOpenDays: 10,
      defaultPickupHours: "18:00-19:30",
    },
    association: {
      name: "Association Brouette",
      email: "contact@brouette.example.com",
      phone: "0200000000",
      address: "1 place du Marche, 35000 Rennes",
    },
    updatedAt: Timestamp.fromDate(now),
  };
  const orders = [
    {
      id: "o1",
      distributionId: "d1",
      memberId: "m1",
      status: "validated",
      totals: { totalAmount: 24.1, itemCount: 4 },
      createdAt: t("2026-02-01T10:00:00.000Z"),
      validatedAt: t("2026-02-01T10:30:00.000Z"),
      memberSnapshot: { name: "Lea Martin", email: "lea.martin@example.com", phone: "0612345678" },
      items: [
        {
          id: "i1",
          offerItemId: "oi1",
          producerId: "p4",
          productId: "pr1",
          variantId: "v1",
          quantity: 2,
          unitPrice: 3.5,
          lineTotal: 7.0,
          label: "Pommes 1kg",
        },
        {
          id: "i2",
          offerItemId: "oi2",
          producerId: "p8",
          productId: "pr3",
          variantId: "v2",
          quantity: 1,
          unitPrice: 5.9,
          lineTotal: 5.9,
          label: "Oeufs boite de 12",
        },
        {
          id: "i3",
          offerItemId: "oi3",
          producerId: "p1",
          productId: "pr2",
          variantId: "v1",
          quantity: 2,
          unitPrice: 4.2,
          lineTotal: 8.4,
          label: "Pommes de terre 2kg",
        },
        {
          id: "i4",
          offerItemId: "oi4",
          producerId: "p7",
          productId: "pr4",
          variantId: "v1",
          quantity: 1,
          unitPrice: 2.8,
          lineTotal: 2.8,
          label: "Fromage de chevre 120g",
        },
      ],
    },
    {
      id: "o2",
      distributionId: "d1",
      memberId: "m2",
      status: "validated",
      totals: { totalAmount: 13.2, itemCount: 3 },
      createdAt: t("2026-02-01T11:00:00.000Z"),
      validatedAt: t("2026-02-01T11:20:00.000Z"),
      memberSnapshot: { name: "Nora Dupont", email: "nora.dupont@example.com", phone: "0623456789" },
      items: [
        {
          id: "i1",
          offerItemId: "oi1",
          producerId: "p4",
          productId: "pr1",
          variantId: "v1",
          quantity: 1,
          unitPrice: 3.5,
          lineTotal: 3.5,
          label: "Pommes 1kg",
        },
        {
          id: "i2",
          offerItemId: "oi5",
          producerId: "p2",
          productId: "pr5",
          variantId: "v1",
          quantity: 1,
          unitPrice: 4.8,
          lineTotal: 4.8,
          label: "Tomates 1kg",
        },
        {
          id: "i3",
          offerItemId: "oi2",
          producerId: "p8",
          productId: "pr3",
          variantId: "v1",
          quantity: 1,
          unitPrice: 3.2,
          lineTotal: 3.2,
          label: "Oeufs boite de 6",
        },
      ],
    },
    {
      id: "o3",
      distributionId: "d2",
      memberId: "m3",
      status: "validated",
      totals: { totalAmount: 9.0, itemCount: 2 },
      createdAt: t("2026-02-12T09:00:00.000Z"),
      validatedAt: t("2026-02-12T09:15:00.000Z"),
      memberSnapshot: { name: "Hugo Bernard", email: "hugo.bernard@example.com", phone: "0634567890" },
      items: [
        {
          id: "i1",
          offerItemId: "oi6",
          producerId: "p3",
          productId: "pr6",
          variantId: "v2",
          quantity: 1,
          unitPrice: 9.0,
          lineTotal: 9.0,
          label: "Miel 500g",
        },
      ],
    },
    {
      id: "o4",
      distributionId: "d2",
      memberId: "m4",
      status: "validated",
      totals: { totalAmount: 11.1, itemCount: 3 },
      createdAt: t("2026-02-12T10:00:00.000Z"),
      validatedAt: t("2026-02-12T10:10:00.000Z"),
      memberSnapshot: { name: "Camille Roche", email: "camille.roche@example.com", phone: "0645678901" },
      items: [
        {
          id: "i1",
          offerItemId: "oi7",
          producerId: "p6",
          productId: "pr7",
          variantId: "v1",
          quantity: 1,
          unitPrice: 3.1,
          lineTotal: 3.1,
          label: "Carottes 1kg",
        },
        {
          id: "i2",
          offerItemId: "oi8",
          producerId: "p9",
          productId: "pr8",
          variantId: "v1",
          quantity: 2,
          unitPrice: 2.2,
          lineTotal: 4.4,
          label: "Basilic botte",
        },
        {
          id: "i3",
          offerItemId: "oi3",
          producerId: "p1",
          productId: "pr2",
          variantId: "v1",
          quantity: 1,
          unitPrice: 4.2,
          lineTotal: 4.2,
          label: "Pommes de terre 2kg",
        },
      ],
    },
    {
      id: "o5",
      distributionId: "d3",
      memberId: "m5",
      status: "validated",
      totals: { totalAmount: 12.6, itemCount: 3 },
      createdAt: t("2026-02-25T12:00:00.000Z"),
      validatedAt: t("2026-02-25T12:15:00.000Z"),
      memberSnapshot: { name: "Louis Giraud", email: "louis.giraud@example.com", phone: "0656789012" },
      items: [
        {
          id: "i1",
          offerItemId: "oi1",
          producerId: "p4",
          productId: "pr1",
          variantId: "v2",
          quantity: 1,
          unitPrice: 6.5,
          lineTotal: 6.5,
          label: "Pommes 2kg",
        },
        {
          id: "i2",
          offerItemId: "oi6",
          producerId: "p3",
          productId: "pr6",
          variantId: "v1",
          quantity: 1,
          unitPrice: 5.0,
          lineTotal: 5.0,
          label: "Miel 250g",
        },
        {
          id: "i3",
          offerItemId: "oi4",
          producerId: "p7",
          productId: "pr4",
          variantId: "v1",
          quantity: 1,
          unitPrice: 2.8,
          lineTotal: 2.8,
          label: "Fromage de chevre 120g",
        },
      ],
    },
    {
      id: "o6",
      distributionId: "d3",
      memberId: "m6",
      status: "draft",
      totals: { totalAmount: 4.8, itemCount: 1 },
      createdAt: t("2026-02-25T13:00:00.000Z"),
      validatedAt: null,
      memberSnapshot: { name: "Emma Leroy", email: "emma.leroy@example.com", phone: "0667890123" },
      items: [
        {
          id: "i1",
          offerItemId: "oi5",
          producerId: "p2",
          productId: "pr5",
          variantId: "v1",
          quantity: 1,
          unitPrice: 4.8,
          lineTotal: 4.8,
          label: "Tomates 1kg",
        },
      ],
    },
    {
      id: "o7",
      distributionId: "d4",
      memberId: "m7",
      status: "validated",
      totals: { totalAmount: 7.2, itemCount: 2 },
      createdAt: t("2026-03-10T10:00:00.000Z"),
      validatedAt: t("2026-03-10T10:05:00.000Z"),
      memberSnapshot: { name: "Noah Fournier", email: "noah.fournier@example.com", phone: "0678901234" },
      items: [
        {
          id: "i1",
          offerItemId: "oi8",
          producerId: "p9",
          productId: "pr8",
          variantId: "v2",
          quantity: 1,
          unitPrice: 4.0,
          lineTotal: 4.0,
          label: "Basilic 2 bottes",
        },
        {
          id: "i2",
          offerItemId: "oi7",
          producerId: "p6",
          productId: "pr7",
          variantId: "v1",
          quantity: 1,
          unitPrice: 3.1,
          lineTotal: 3.1,
          label: "Carottes 1kg",
        },
      ],
    },
    {
      id: "o8",
      distributionId: "d4",
      memberId: "m8",
      status: "validated",
      totals: { totalAmount: 10.4, itemCount: 3 },
      createdAt: t("2026-03-10T11:00:00.000Z"),
      validatedAt: t("2026-03-10T11:10:00.000Z"),
      memberSnapshot: { name: "Jules Morel", email: "jules.morel@example.com", phone: "0689012345" },
      items: [
        {
          id: "i1",
          offerItemId: "oi2",
          producerId: "p8",
          productId: "pr3",
          variantId: "v1",
          quantity: 1,
          unitPrice: 3.2,
          lineTotal: 3.2,
          label: "Oeufs boite de 6",
        },
        {
          id: "i2",
          offerItemId: "oi1",
          producerId: "p4",
          productId: "pr1",
          variantId: "v1",
          quantity: 1,
          unitPrice: 3.5,
          lineTotal: 3.5,
          label: "Pommes 1kg",
        },
        {
          id: "i3",
          offerItemId: "oi6",
          producerId: "p3",
          productId: "pr6",
          variantId: "v1",
          quantity: 1,
          unitPrice: 5.0,
          lineTotal: 5.0,
          label: "Miel 250g",
        },
      ],
    },
    {
      id: "o9",
      distributionId: "d5",
      memberId: "m9",
      status: "validated",
      totals: { totalAmount: 9.6, itemCount: 2 },
      createdAt: t("2026-03-25T10:00:00.000Z"),
      validatedAt: t("2026-03-25T10:20:00.000Z"),
      memberSnapshot: { name: "Zoe Petit", email: "zoe.petit@example.com", phone: "0690123456" },
      items: [
        {
          id: "i1",
          offerItemId: "oi3",
          producerId: "p1",
          productId: "pr2",
          variantId: "v2",
          quantity: 1,
          unitPrice: 9.5,
          lineTotal: 9.5,
          label: "Pommes de terre 5kg",
        },
      ],
    },
    {
      id: "o10",
      distributionId: "d5",
      memberId: "m10",
      status: "cancelled",
      totals: { totalAmount: 6.5, itemCount: 1 },
      createdAt: t("2026-03-25T11:00:00.000Z"),
      validatedAt: null,
      memberSnapshot: { name: "Nina Lopez", email: "nina.lopez@example.com", phone: "0601020304" },
      items: [
        {
          id: "i1",
          offerItemId: "oi1",
          producerId: "p4",
          productId: "pr1",
          variantId: "v2",
          quantity: 1,
          unitPrice: 6.5,
          lineTotal: 6.5,
          label: "Pommes 2kg",
        },
      ],
    },
  ];
  const batchItems: BatchItem[] = [];

  for (const member of members) {
    const { id, ...data } = member;
    batchItems.push({ refPath: ["members", id], data });
  }

  for (const producer of producers) {
    const { id, ...data } = producer;
    batchItems.push({ refPath: ["producers", id], data });
  }

  for (const product of products) {
    const { id, variants, ...data } = product;
    batchItems.push({ refPath: ["products", id], data });
    for (const variant of variants) {
      const { id: variantId, ...variantData } = variant;
      batchItems.push({
        refPath: ["products", id, "variants", variantId],
        data: variantData,
      });
    }
  }

  for (const distribution of distributions) {
    const { id, ...data } = distribution;
    batchItems.push({ refPath: ["distributionDates", id], data });

    const producerLinks = ["p1", "p2", "p3", "p4", "p6"].map((pid, index) => ({
      id: `dp${index + 1}`,
      producerId: pid,
      active: true,
      note: index % 2 === 0 ? "Present" : "Livraison partielle",
    }));

    for (const link of producerLinks) {
      const { id: linkId, ...linkData } = link;
      batchItems.push({
        refPath: ["distributionDates", id, "producers", linkId],
        data: linkData,
      });
    }

    const offerItems = [
      { id: "oi1", producerId: "p4", productId: "pr1", variantId: "v1", title: "Pommes", variantLabel: "1kg", imageUrl: "/images/pommes.jpg", isOrganic: true, price: 3.5 },
      { id: "oi2", producerId: "p8", productId: "pr3", variantId: "v1", title: "Oeufs", variantLabel: "Boite de 6", imageUrl: "/images/oeufs.jpg", isOrganic: false, price: 3.2 },
      { id: "oi3", producerId: "p1", productId: "pr2", variantId: "v1", title: "Pommes de terre", variantLabel: "2kg", imageUrl: "/images/pdt.jpg", isOrganic: true, price: 4.2 },
      { id: "oi4", producerId: "p7", productId: "pr4", variantId: "v1", title: "Fromage de chevre", variantLabel: "120g", imageUrl: "/images/chevre.jpg", isOrganic: true, price: 2.8 },
      { id: "oi5", producerId: "p2", productId: "pr5", variantId: "v1", title: "Tomates", variantLabel: "1kg", imageUrl: "/images/tomates.jpg", isOrganic: true, price: 4.8 },
      { id: "oi6", producerId: "p3", productId: "pr6", variantId: "v2", title: "Miel", variantLabel: "500g", imageUrl: "/images/miel.jpg", isOrganic: true, price: 9.0 },
      { id: "oi7", producerId: "p6", productId: "pr7", variantId: "v1", title: "Carottes", variantLabel: "1kg", imageUrl: "/images/carottes.jpg", isOrganic: false, price: 3.1 },
      { id: "oi8", producerId: "p9", productId: "pr8", variantId: "v1", title: "Basilic", variantLabel: "Botte", imageUrl: "/images/basilic.jpg", isOrganic: true, price: 2.2 },
      { id: "oi9", producerId: "p4", productId: "pr1", variantId: "v2", title: "Pommes", variantLabel: "2kg", imageUrl: "/images/pommes.jpg", isOrganic: true, price: 6.5 },
      { id: "oi10", producerId: "p1", productId: "pr2", variantId: "v2", title: "Pommes de terre", variantLabel: "5kg", imageUrl: "/images/pdt.jpg", isOrganic: true, price: 9.5 },
    ];

    for (const offer of offerItems) {
      const { id: offerId, ...offerData } = offer;
      batchItems.push({
        refPath: ["distributionDates", id, "offerItems", offerId],
        data: {
          ...offerData,
          status: "active",
          limitQuantity: 20,
          remainingQuantity: 20,
        },
      });
    }
  }

  for (const order of orders) {
    const { id, items, ...data } = order;
    batchItems.push({ refPath: ["orders", id], data });
    for (const item of items) {
      const { id: itemId, ...itemData } = item;
      batchItems.push({
        refPath: ["orders", id, "items", itemId],
        data: itemData,
      });
    }
  }

  for (const docEntry of documents) {
    const { id, ...data } = docEntry;
    batchItems.push({ refPath: ["documents", id], data });
  }

  for (const message of messages) {
    const { id, ...data } = message;
    batchItems.push({ refPath: ["messages", id], data });
  }

  batchItems.push({ refPath: ["settings", settings.id], data: settings });

  const batches = chunk(batchItems, 400);
  for (const items of batches) {
    const batch = writeBatch(firebaseDb);
    for (const item of items) {
      batch.set(docRefFromPath(item.refPath), item.data, { merge: false });
    }
    await batch.commit();
  }

  return { writes: batchItems.length };
}

function nextWeekday(base: Date, weekday: number) {
  const date = new Date(base);
  date.setHours(18, 0, 0, 0);
  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() + 1);
  }
  if (date <= base) {
    date.setDate(date.getDate() + 7);
  }
  return date;
}

export async function resetDistributions() {
  const snapshot = await getDocs(collection(firebaseDb, "distributionDates"));
  const deleteBatch = writeBatch(firebaseDb);
  snapshot.docs.forEach((docSnap) => {
    deleteBatch.delete(doc(firebaseDb, "distributionDates", docSnap.id));
  });
  await deleteBatch.commit();

  const now = new Date();
  const base = nextWeekday(now, 5);
  const createBatch = writeBatch(firebaseDb);
  const dates: Date[] = [];
  for (let i = 0; i < 3; i += 1) {
    const date = new Date(base);
    date.setDate(base.getDate() + i * 14);
    dates.push(date);
  }

  const docRef = doc(collection(firebaseDb, "distributionDates"));
  createBatch.set(docRef, {
    title: "Periode 1",
    dates: dates.map((date) => Timestamp.fromDate(date)),
    status: "planned",
  });

  await createBatch.commit();

  return { deleted: snapshot.size, created: 1 };
}
