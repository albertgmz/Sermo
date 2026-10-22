import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MembersView } from "@/app/[locale]/(main)/members/members-view";
import { publicHead } from "@/lib/sermo/share";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.members");
  return publicHead({ title: t("metaTitle") }, { path: "/members" });
}

export default async function MembersPage({
  searchParams,
}: PageProps<"/[locale]/members">) {
  return <MembersView params={await searchParams} />;
}
