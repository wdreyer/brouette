import type { User } from "firebase/auth";
import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";

export async function findMemberByUser(db: Firestore, user: User) {
  const uidQuery = query(collection(db, "members"), where("auth.uid", "==", user.uid));
  const uidSnap = await getDocs(uidQuery);
  if (!uidSnap.empty) {
    const docSnap = uidSnap.docs[0];
    return { id: docSnap.id, data: docSnap.data() };
  }

  if (user.email) {
    const emailQuery = query(collection(db, "members"), where("email", "==", user.email));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      const docSnap = emailSnap.docs[0];
      return { id: docSnap.id, data: docSnap.data() };
    }
  }

  return null;
}
