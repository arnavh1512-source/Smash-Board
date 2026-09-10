/** Single place for the details that appear across the site. */

export const SITE = {
  name: "SmashBoard",
  tagline: "Badminton tournament scoring that everyone can follow live",
  description:
    "Run a badminton tournament end to end: add entrants, make the draw, enter scores as each game finishes, and give every player a live link to follow the results.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://smashboard.vercel.app",
  locale: "en_IN",
  whatsappNumber: "918140081461",
} as const;

/** wa.me link with an optional pre-filled message. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${SITE.whatsappNumber}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
