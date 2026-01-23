"use client";

import { firebaseApp } from "@/lib/firebase/client";

export default function FirebaseStatus() {
  return (
    <p>
      Firebase initialized: <strong>{firebaseApp.name}</strong>
    </p>
  );
}
