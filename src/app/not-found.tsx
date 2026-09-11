import Link from "next/link";

/**
 * The 404 page, served with a real 404 status.
 *
 * Most links to this app are pasted into group chats, so the common way to
 * land here is a link that lost a character on the way. Say that plainly and
 * offer the one door back.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h3>Page not found</h3>
      <p className="text-[13px] opacity-75">
        That link does not exist. It may have been mistyped, or the organiser may have deleted the
        tournament it pointed at.
      </p>
      <Link href="/" className="text-[13px]">
        Back to all tournaments
      </Link>
    </div>
  );
}
