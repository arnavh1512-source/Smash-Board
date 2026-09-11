import type { Metadata } from "next";
import { ManageConsole } from "@/components/manage/ManageConsole";

/** The referee console is never worth indexing. */
export const metadata: Metadata = {
  title: "Referee console",
  robots: { index: false, follow: false },
};

export default async function ScorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ManageConsole slug={slug} role="referee" />;
}
