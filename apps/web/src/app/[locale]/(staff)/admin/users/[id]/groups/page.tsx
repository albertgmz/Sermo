import {
  promotionsApply,
  promotionsMemberStatus,
  usersGetGroups,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { ItemList } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { call, read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { getGroups, groupLabel } from "../../../groups/data";
import {
  getMember,
  holds,
  ifAllowed,
  isReadOnly,
  memberIdOf,
} from "../../data";
import { TabPage } from "../../tab-page";
import { applyPromotion } from "./actions";
import { GroupsForm } from "./groups-form";
import { PromotionApply } from "./promotion-apply";
import { SuperAdminForm } from "./super-admin-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.groups");
  return { title: t("metaTitle") };
}

async function Groups({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/users/[id]/groups">["params"];
  searchParams: PageProps<"/[locale]/admin/users/[id]/groups">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [t, p, viewer, member, held, groups] = await Promise.all([
    getTranslations("adminUsers.groups"),
    getTranslations("adminUsers.promotions"),
    getViewer(),
    getMember(userId),
    ifAllowed(() => read(usersGetGroups, { userId })),
    getGroups(),
  ]);
  const readOnly = isReadOnly(member);
  const status =
    held && holds(viewer, "admin.promotions")
      ? await ifAllowed(() => call(promotionsMemberStatus, { userId }))
      : null;
  const title = (id: number) =>
    groupLabel(groups, id, (n) => t("groupId", { id: n }));
  return (
    <>
      <Notice
        namespace="adminUsers.notices"
        searchParams={searchParams}
        shown={["saved", "promotionApplied", "superAdminSaved"]}
      />
      {held ? (
        <GroupsForm
          userId={userId}
          groups={groups}
          held={held}
          readOnly={readOnly}
        />
      ) : (
        <Section heading={t("heading")}>
          <EmptyState
            title={t("refusedTitle")}
            description={t("refusedDescription")}
          />
        </Section>
      )}
      {member.canSetSuperAdmin && (
        <SuperAdminForm userId={userId} superAdmin={member.isSuperAdmin} />
      )}
      {status && (
        <ItemList
          label={p("heading")}
          heading={p("heading")}
          description={p("description")}
          empty={{ title: p("empty") }}
          items={status.items.map((item) => ({
            id: item.promotionId,
            title: item.title,
            description: (
              <>
                {p("state", { state: item.state ?? "none" })}
                {" · "}
                {item.eligible ? p("eligible") : p("notEligible")}
                {item.grantedGroupIds.length > 0 &&
                  ` · ${p("grants", { groups: item.grantedGroupIds.map(title).join(", ") })}`}
              </>
            ),
            panel: readOnly ? undefined : (
              <PromotionApply
                action={applyPromotion}
                actions={promotionsApply.input.shape.action.options}
                userId={userId}
                promotionId={item.promotionId}
              />
            ),
          }))}
        />
      )}
    </>
  );
}

export default function MemberGroupsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users/[id]/groups">) {
  const t = useTranslations("adminUsers.groups");
  return (
    <TabPage label={t("loading")} rows={4}>
      <Groups params={params} searchParams={searchParams} />
    </TabPage>
  );
}
