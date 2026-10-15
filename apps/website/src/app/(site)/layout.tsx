import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import "../globals.css";
import "./marketing.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://opasafety.com"),
  title: {
    default: "OPA â€” Enterprise Safety & Operational Intelligence",
    template: "%s | OPA",
  },
  description:
    "OPA protects people before, during, and after emergencies with SOS, journey protection, live incident intelligence, and institutional Command Center coordination.",
  openGraph: {
    title: "OPA â€” Enterprise Safety & Operational Intelligence",
    description:
      "Connected safety, incident coordination, identity, evidence and insight for institutions, workplaces and families.",
    url: "https://opasafety.com",
    siteName: "OPA",
    locale: "en_NG",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="marketing min-h-full flex flex-col bg-base text-ink font-sans">
        <a className="m-skip" href="#main-content">
          Skip to content
        </a>
        <Navbar />
        <main id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}


