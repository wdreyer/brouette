"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import CollectionEditor from "@/components/admin/CollectionEditor";
import DistributionsEditor from "@/components/admin/DistributionsEditor";
import MembersEditor from "@/components/admin/MembersEditor";
import ProductsEditor from "@/components/admin/ProductsEditor";
import ProducersEditor from "@/components/admin/ProducersEditor";
import InvitesEditor from "@/components/admin/InvitesEditor";
import OrdersEditor from "@/components/admin/OrdersEditor";

const COLLECTIONS: Record<
  string,
  { title: string; description: string; fields: { label: string; path: string; type: "text" | "number" | "boolean" | "date" | "datetime"; table?: boolean }[] }
> = {
  members: {
    title: "Adherents",
    description: "Profil, contact, statut d'adhesion et lien Auth.",
    fields: [
      { label: "Prenom", path: "firstName", type: "text", table: true },
      { label: "Nom", path: "lastName", type: "text", table: true },
      { label: "Email", path: "email", type: "text", table: true },
      { label: "Telephone", path: "phone", type: "text" },
      { label: "Adresse", path: "address.street", type: "text" },
      { label: "Code postal", path: "address.postalCode", type: "text" },
      { label: "Ville", path: "address.city", type: "text" },
      { label: "Statut", path: "membershipStatus", type: "text", table: true },
      { label: "Debut adhesion", path: "membership.startDate", type: "date" },
      { label: "Fin adhesion", path: "membership.endDate", type: "date" },
      { label: "Mode paiement", path: "membership.paymentMode", type: "text" },
      { label: "Note interne", path: "membership.internalNote", type: "text" },
      { label: "Auth UID", path: "auth.uid", type: "text" },
      { label: "Role", path: "auth.role", type: "text", table: true },
    ],
  },
  producers: {
    title: "Producteurs",
    description: "Coordonnees et statut dans la coop.",
    fields: [
      { label: "Nom", path: "name", type: "text", table: true },
      { label: "Contact prenom", path: "contact.firstName", type: "text" },
      { label: "Contact nom", path: "contact.lastName", type: "text" },
      { label: "Email", path: "email", type: "text", table: true },
      { label: "Telephone", path: "phone", type: "text" },
      { label: "Adresse", path: "address.street", type: "text" },
      { label: "Code postal", path: "address.postalCode", type: "text" },
      { label: "Ville", path: "address.city", type: "text" },
      { label: "Statut coop", path: "coopStatus", type: "text", table: true },
      { label: "Notes", path: "notes", type: "text" },
    ],
  },
  products: {
    title: "Produits",
    description: "Catalogue principal. Variantes dans la sous-collection products/{id}/variants.",
    fields: [
      { label: "Nom", path: "name", type: "text", table: true },
      { label: "Producteur", path: "producerId", type: "text", table: true },
      { label: "Categorie", path: "categoryId", type: "text" },
      { label: "Description", path: "description", type: "text" },
      { label: "Image URL", path: "imageUrl", type: "text" },
      { label: "Bio", path: "isOrganic", type: "boolean" },
    ],
  },
  catalogues: {
    title: "Categories",
    description: "Categories de produits (fruits, legumes, etc.).",
    fields: [
      { label: "Nom", path: "name", type: "text", table: true },
      { label: "Description", path: "description", type: "text" },
    ],
  },
  distributionDates: {
    title: "Distributions",
    description: "Chaque distribution est une periode de 3 dates espacees de 2 semaines.",
    fields: [
      { label: "Date 1", path: "dates.0", type: "date", table: true },
      { label: "Date 2", path: "dates.1", type: "date", table: true },
      { label: "Date 3", path: "dates.2", type: "date", table: true },
      { label: "Statut", path: "status", type: "text", table: true },
    ],
  },
  orders: {
    title: "Commandes",
    description: "Commandes par adherent. Lignes dans orders/{id}/items.",
    fields: [
      { label: "Distribution", path: "distributionId", type: "text", table: true },
      { label: "Adherent ID", path: "memberId", type: "text", table: true },
      { label: "Statut", path: "status", type: "text", table: true },
      { label: "Total EUR", path: "totals.totalAmount", type: "number", table: true },
      { label: "Nb articles", path: "totals.itemCount", type: "number" },
      { label: "Cree le", path: "createdAt", type: "datetime" },
      { label: "Validee le", path: "validatedAt", type: "datetime" },
    ],
  },
  messages: {
    title: "Messages",
    description: "Logs d'envoi et files de messages.",
    fields: [
      { label: "Cible", path: "target", type: "text", table: true },
      { label: "Distribution", path: "distributionId", type: "text" },
      { label: "Objet", path: "subject", type: "text", table: true },
      { label: "Statut", path: "status", type: "text", table: true },
      { label: "Contenu", path: "content", type: "text" },
      { label: "Nb destinataires", path: "stats.recipients", type: "number" },
      { label: "Date envoi", path: "stats.sentAt", type: "datetime" },
    ],
  },
  documents: {
    title: "Documents PDF",
    description: "Historique des exports et chemins Storage.",
    fields: [
      { label: "Type", path: "type", type: "text", table: true },
      { label: "Distribution", path: "distributionId", type: "text", table: true },
      { label: "Producteur ID", path: "producerId", type: "text" },
      { label: "Chemin Storage", path: "storagePath", type: "text" },
      { label: "Genere le", path: "generatedAt", type: "datetime" },
      { label: "Genere par", path: "generatedBy", type: "text" },
    ],
  },
  settings: {
    title: "Parametres",
    description: "Configurations globales (par doc).",
    fields: [
      { label: "Texte accueil", path: "texts.welcome", type: "text", table: true },
      { label: "Footer", path: "texts.footer", type: "text" },
      { label: "Email confirmation", path: "emailTemplates.orderConfirmation", type: "text" },
      { label: "Email rappel", path: "emailTemplates.pickupReminder", type: "text" },
      { label: "Jours ouverture", path: "rules.defaultOpenDays", type: "number", table: true },
      { label: "Horaires retrait", path: "rules.defaultPickupHours", type: "text" },
      { label: "Association nom", path: "association.name", type: "text", table: true },
      { label: "Association email", path: "association.email", type: "text" },
      { label: "Association tel", path: "association.phone", type: "text" },
      { label: "Association adresse", path: "association.address", type: "text" },
      { label: "Maj", path: "updatedAt", type: "datetime" },
    ],
  },
};

export default function AdminCollectionPage() {
  const params = useParams<{ collection: string }>();
  const key = params?.collection ?? "";
  const config = useMemo(() => COLLECTIONS[key], [key]);

  if (!config) {
    return (
      <div className="rounded-2xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">Collection inconnue</h2>
        <p className="mt-2 text-sm text-ink/70">
          Utilise le menu pour acceder a une collection geree.
        </p>
      </div>
    );
  }

  if (key === "members") {
    return (
      <MembersEditor
        collectionName={key}
        title={config.title}
        description={config.description}
        fields={config.fields}
      />
    );
  }

  if (key === "products") {
    return (
      <ProductsEditor
        collectionName={key}
        title={config.title}
        description={config.description}
        fields={config.fields}
      />
    );
  }

  if (key === "producers") {
    return (
      <ProducersEditor
        collectionName={key}
        title={config.title}
        description={config.description}
        fields={config.fields}
      />
    );
  }

  if (key === "distributionDates") {
    return (
      <DistributionsEditor
        collectionName={key}
        title={config.title}
        description={config.description}
        fields={config.fields}
      />
    );
  }

  if (key === "orders") {
    return <OrdersEditor />;
  }

  if (key === "catalogues") {
    return (
      <CollectionEditor
        collectionName="categories"
        title={config.title}
        description={config.description}
        fields={config.fields}
      />
    );
  }

  if (key === "invites") {
    return <InvitesEditor />;
  }

  return (
    <CollectionEditor
      collectionName={key}
      title={config.title}
      description={config.description}
      fields={config.fields}
    />
  );
}
