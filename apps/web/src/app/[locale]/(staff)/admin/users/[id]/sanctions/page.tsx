import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { getMember, holds, isReadOnly, memberIdOf } from "../../data";
import { TabPage } from "../../tab-page";
import { Bans, Restrictions, ThreadBans, Warnings } from "./sections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.sanctions");
  return { title: t("metaTitle") };
}

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

async function Sanctions({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/users/[id]/sanctions">["params"];
  searchParams: PageProps<"/[locale]/admin/users/[id]/sanctions">["searchParams"];
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
        namespace="adminUsers.notices"
        searchParams={searchParams}
        shown={[
          "warned",
          "restricted",
          "restrictionLifted",
          "banned",
          "banLifted",
          "threadBanLifted",
        ]}
      />
      {(holds(viewer, "warning.view") || holds(viewer, "member.warn")) && (
        <Warnings
          userId={userId}
          params={query}
          mayList={holds(viewer, "warning.view")}
          mayIssue={holds(viewer, "member.warn")}
          readOnly={readOnly}
        />
      )}
      {(holds(viewer, "warning.view") || holds(viewer, "member.restrict")) && (
        <Restrictions
          userId={userId}
          mayList={holds(viewer, "warning.view")}
          mayChange={holds(viewer, "member.restrict")}
          readOnly={readOnly}
        />
      )}
      {holds(viewer, "member.ban") && (
        <Bans userId={userId} params={query} readOnly={readOnly} />
      )}
      {/* `forum.threadBan` is a permission of one forum: no site-wide list holds it, so the
          lookup is offered to whoever may open the tab and the backend answers for the forum. */}
      <ThreadBans
        userId={userId}
        thread={parseId(one(query.thread))}
        readOnly={readOnly}
      />
    </>
  );
}

export default function MemberSanctionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users/[id]/sanctions">) {
  const t = useTranslations("adminUsers.sanctions");
  return (
    <TabPage label={t("loading")} rows={4}>
      <Sanctions params={params} searchParams={searchParams} />
    </TabPage>
  );
}
