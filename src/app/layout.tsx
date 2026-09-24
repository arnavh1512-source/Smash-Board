import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { SITE, whatsappLink } from "@/lib/site";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/ThemeToggle";

/** Regular for body copy, 800 for every heading and button — the design uses no other weights. */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "800"],
  display: "swap",
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
    // The theme script adds its class to <html> before React hydrates.
    <html lang="en" className={`${archivo.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* next/script, not a raw <script>: when Next renders the root layout on the
            client (a not-found page, say) React warns about raw script tags. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ // A literal `</script>` inside a JSON string would close the tag early.
            __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
        />
        <ConvexClientProvider>
          <header className="nav sticky top-0 z-40">
            <Link href="/" className="nav-brand truncate uppercase">
              {SITE.name}
            </Link>
            <ThemeToggle />
            <Link href="/#create" className="inline-flex min-h-[44px] items-center whitespace-nowrap">
              New tournament
            </Link>
          </header>

          <main className="flex-1">{children}</main>

          {/* pr-20 keeps the footer link clear of the floating WhatsApp button. */}
          <footer className="rule-t2 flex items-center justify-between gap-3 py-3.5 pl-4 pr-20">
            <span className="text-[11px] text-muted">
              {SITE.name} · {SITE.locale.replace("_", "-")}
            </span>
            <a
              href={whatsappLink(`Hi, I need help running a tournament on ${SITE.name}.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center text-[12px]"
            >
              Questions? WhatsApp us
            </a>
          </footer>

          <WhatsAppButton message={`Hi, I need help running a tournament on ${SITE.name}.`} />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
