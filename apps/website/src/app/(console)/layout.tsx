import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

/**
 * ROOT LAYOUT FOR THE OPERATOR CONSOLE.
 *
 * This is a SECOND root layout, not a nested one. app/ deliberately has no
 * layout.tsx: Next only permits multiple roots when there is nothing at the
 * top to wrap them, and a nested layout renders INSIDE its parent, so it
 * could never have removed the marketing Navbar and Footer.
 *
 * WHAT IS ABSENT HERE IS THE POINT. No Navbar, no Footer, no "Partner with
 * us", no Careers link. An operator watching a live emergency queue should
 * not be one misclick from the contact form, and every 14A-5 through 14A-12
 * screen would otherwise have been built inside marketing chrome.
 *
 * The fonts are declared again rather than shared. next/font/google generates
 * per-file font instances; there is no import-once form. NOTE THAT THIS
 * DOUBLES THE BUILD-TIME FETCHES TO fonts.gstatic.com - the dependency that
 * broke the bd30be5 Vercel build when Google rotated the Archivo URLs.
 * Self-hosting via next/font/local is now more urgent than it was.
 *
 * globals.css is imported here as well as in (site)/layout.tsx. It stays at
 * app/globals.css and both roots reach it with `../globals.css`.
 */

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
  title: {
    default: "Command Center",
    template: "%s | OPA Command Center",
  },
  // The console is not a public surface. The pages set this individually too;
  // saying it once at the root means a new operator page cannot forget.
  robots: { index: false, follow: false, nocache: true },
};

export default function ConsoleRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-base text-ink font-sans">
        {children}
      </body>
    </html>
  );
}