import type { Metadata } from "next";
import { ManageConsole } from "@/components/manage/ManageConsole";

/** The organiser console is never worth indexing. */
export const metadata: Metadata = {
  title: "Organiser console",
  robots: { index: false, follow: false },
};

export default async function ManagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ManageConsole slug={slug} />;
}
