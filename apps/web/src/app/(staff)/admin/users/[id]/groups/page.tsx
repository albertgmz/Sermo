import {
  promotionsApply,
  promotionsMemberStatus,
  usersGetGroups,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
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
import { Notice } from "../../notice";
import { TabPage } from "../../tab-page";
import { applyPromotion } from "./actions";
import { GroupsForm } from "./groups-form";
import { PromotionApply } from "./promotion-apply";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.groups");
  return { title: t("metaTitle") };
}

async function Groups({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/users/[id]/groups">["params"];
  searchParams: PageProps<"/admin/users/[id]/groups">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [t, p, viewer, member, held, groups] = await Promise.all([
    getTranslations("adminUsers.groups"),
    getTranslations("adminUsers.promotions"),
    getViewer(),
    getMember(userId),
    read(usersGetGroups, { userId }),
    getGroups(),
  ]);
  const readOnly = isReadOnly(member);
  const status = holds(viewer, "admin.promotions")
    ? await ifAllowed(() => call(promotionsMemberStatus, { userId }))
    : null;
  const title = (id: number) =>
    groupLabel(groups, id, (n) => t("groupId", { id: n }));
  return (
    <>
      <Notice
        searchParams={searchParams}
        shown={["saved", "promotionApplied"]}
      />
      <GroupsForm
        userId={userId}
        groups={groups}
        held={held}
        readOnly={readOnly}
      />
      {status && (
        <Section heading={p("heading")} description={p("description")}>
          {status.items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{p("empty")}</p>
          ) : (
            <ul className="divide-y">
              {status.items.map((item) => (
                <li
                  key={item.promotionId}
                  className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p("state", {
                        state: item.state ?? "none",
                      })}
                      {" · "}
                      {item.eligible ? p("eligible") : p("notEligible")}
                      {item.grantedGroupIds.length > 0 &&
                        ` · ${p("grants", { groups: item.grantedGroupIds.map(title).join(", ") })}`}
                    </p>
                  </div>
                  {!readOnly && (
                    <PromotionApply
                      action={applyPromotion}
                      actions={promotionsApply.input.shape.action.options}
                      userId={userId}
                      promotionId={item.promotionId}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}

export default function MemberGroupsPage({
  params,
  searchParams,
}: PageProps<"/admin/users/[id]/groups">) {
  const t = useTranslations("adminUsers.groups");
  return (
    <TabPage label={t("loading")} rows={4}>
      <Groups params={params} searchParams={searchParams} />
    </TabPage>
  );
}
