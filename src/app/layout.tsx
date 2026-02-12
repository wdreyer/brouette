import type { Metadata } from "next";
import HeaderBar from "@/components/HeaderBar";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthGate from "@/components/auth/AuthGate";
import ProfileGate from "@/components/profile/ProfileGate";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brouette - Coop Locale",
  description: "Catalogue et commandes de la coop Brouette.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className="bg-stone text-ink font-sans antialiased"
        suppressHydrationWarning
      >
        <div className="relative min-h-screen bg-stone">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-[-15%] top-[-20%] h-[360px] w-[360px] rounded-full bg-honey/10 blur-[2px]" />
            <div className="absolute right-[-8%] top-[0%] h-[320px] w-[320px] rounded-full bg-moss/8 blur-[2px]" />
          </div>
          <AuthProvider>
            <HeaderBar />
            <AuthGate>
              <ProfileGate>
                <main className="relative z-10">{children}</main>
              </ProfileGate>
            </AuthGate>
          </AuthProvider>
        </div>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
