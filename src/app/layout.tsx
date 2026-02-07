import type { Metadata } from "next";
import HeaderBar from "@/components/HeaderBar";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthGate from "@/components/auth/AuthGate";
import ProfileGate from "@/components/profile/ProfileGate";
import { Cormorant_Garamond, Work_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const workSans = Work_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

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
        className={`${workSans.variable} ${cormorant.variable} bg-stone text-ink font-sans antialiased`}
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
