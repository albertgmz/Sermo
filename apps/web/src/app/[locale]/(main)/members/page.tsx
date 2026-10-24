import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MembersScreen } from "@/app/[locale]/(main)/members/members-view";
import { pageParam } from "@/components/forum/page-window";
import { publicHead } from "@/lib/sermo/share";

export async function generateMetadata({
  searchParams,
}: PageProps<"/[locale]/members">): Promise<Metadata> {
  const [t, { page }] = await Promise.all([
    getTranslations("members.members"),
    searchParams,
  ]);
  const head = publicHead({ title: t("metaTitle") }, { path: "/members" });
  // A later page of a ranking or of the directory is a copy of the first.
  return pageParam(page) > 1
    ? { ...head, robots: { index: false, follow: true } }
    : head;
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
  return <MembersScreen query={params} path="/members" />;
}
