import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getViewer } from "@/lib/sermo/session";
import { getMember, holds, isReadOnly, memberIdOf } from "../../data";
import { Notice } from "../../notice";
import { TabPage } from "../../tab-page";
import { Adjust, Awards, Inventory, Ledger } from "./sections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.economy");
  return { title: t("metaTitle") };
}

async function Economy({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/users/[id]/economy">["params"];
  searchParams: PageProps<"/admin/users/[id]/economy">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [viewer, member, query] = await Promise.all([
    getViewer(),
    getMember(userId),
    searchParams,
  ]);
  const readOnly = isReadOnly(member);
  return (
    <>
      <Notice
        searchParams={searchParams}
        shown={["adjusted", "granted", "revoked"]}
      />
      {holds(viewer, "credits.viewAny") && (
        <Ledger userId={userId} params={query} balance={member.credits} />
      )}
      {holds(viewer, "credits.adjust") && (
        <Adjust userId={userId} readOnly={readOnly} />
      )}
      {holds(viewer, "admin.shop") && (
        <Inventory userId={userId} params={query} />
      )}
      <Awards
        userId={userId}
        params={query}
        mayGrant={holds(viewer, "award.grant")}
        readOnly={readOnly}
      />
    </>
  );
}

export default function MemberEconomyPage({
  params,
  searchParams,
}: PageProps<"/admin/users/[id]/economy">) {
  const t = useTranslations("adminUsers.economy");
  return (
    <TabPage label={t("loading")} rows={4}>
      <Economy params={params} searchParams={searchParams} />
    </TabPage>
  );
}
