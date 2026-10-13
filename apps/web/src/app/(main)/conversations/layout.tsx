import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NOINDEX } from "@/lib/sermo/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("conversations.layout");
  return {
    title: t("metaTitle"),
    robots: NOINDEX,
  };
}

export default function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
