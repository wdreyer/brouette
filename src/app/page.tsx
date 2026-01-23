import FirebaseStatus from "@/components/FirebaseStatus";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>Next.js + Firebase</h1>
          <p>Ton projet est pret. Il ne reste plus qu'a brancher Firebase.</p>
        </div>
        <FirebaseStatus />
      </main>
    </div>
  );
}
