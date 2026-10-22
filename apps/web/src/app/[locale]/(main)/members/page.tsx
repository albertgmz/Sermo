import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
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
  const params = await searchParams;
  // The standing of a month has one address.
  if (params.view === "month") {
    const { view: _view, ...rest } = params;
    const query = new URLSearchParams(
      Object.entries(rest).flatMap(([name, value]) =>
        [value ?? []].flat().map((one): [string, string] => [name, one]),
      ),
    ).toString();
    permanentRedirect(`/members/month${query ? `?${query}` : ""}`);
  }
  return <MembersView params={params} />;
}
