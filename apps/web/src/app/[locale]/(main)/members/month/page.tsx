import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MembersView } from "@/app/[locale]/(main)/members/members-view";
import { publicHead } from "@/lib/sermo/share";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.views");
  return publicHead({ title: t("monthLabel") }, { path: "/members/month" });
}

// The standing of any month, asked for with `?month=YYYY-MM`: the member of the month view with
// the month chosen.
export default async function MonthPage({
  searchParams,
}: PageProps<"/[locale]/members/month">) {
  return <MembersView params={{ ...(await searchParams), view: "month" }} />;
}
