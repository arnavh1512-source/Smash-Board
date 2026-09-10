import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { SITE } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [
    "badminton tournament software",
    "badminton scoring app",
    "live badminton scores",
    "badminton draw generator",
    "round robin badminton",
    "tournament management India",
  ],
  applicationName: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: SITE.locale,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE.url,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: { index: true, follow: true },
};

/**
 * Answer Engine Optimisation: a plain question-and-answer block that assistants
 * and search engines can quote directly.
 */
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How do I run a badminton tournament with SmashBoard?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Create a tournament, add a category with the scoring rules you want, add the entrants, generate the draw, then enter each score as the game finishes. Players follow the public link for live results.",
      },
    },
    {
      "@type": "Question",
      name: "Which badminton scoring formats are supported?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Games to 11, 15, 21 or any custom target, played as a single game or best of three, five or seven, with either deuce (win by two, with an optional cap) or golden point at the end.",
      },
    },
    {
      "@type": "Question",
      name: "Do players need an account to see the scores?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Anyone with the tournament link sees the draw, the live scores and the standings. Only the organiser needs the PIN to make changes.",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <ConvexClientProvider>
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M14.7 2.4a3 3 0 0 1 4.2 4.2l-6.1 6.1-4.2-4.2 6.1-6.1Zm-7.5 7.5 4.2 4.2-1.4 1.4a3 3 0 0 1-4.2-4.2l1.4-1.4Zm-2.6 8.4 2.6 2.6-1.9 1.9a1.8 1.8 0 0 1-2.6-2.6l1.9-1.9Z" />
                  </svg>
                </span>
                <span>{SITE.name}</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
                <Link href="/" className="hover:text-emerald-700">
                  Tournaments
                </Link>
                <Link
                  href="/#create"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700"
                >
                  New tournament
                </Link>
              </nav>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="border-t border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p>
                {SITE.name} — {SITE.tagline}.
              </p>
              <p>Built in Ahmedabad, India.</p>
            </div>
          </footer>

          <WhatsAppButton message={`Hi, I need help running a tournament on ${SITE.name}.`} />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
