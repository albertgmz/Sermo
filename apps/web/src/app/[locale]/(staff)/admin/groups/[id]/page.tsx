import { groupsGet } from "@sermo/core/contracts";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Notice } from "@/components/staff/notice";
import { HeaderLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { Badge } from "@/components/ui/badge";
import { inVisitorsLanguage } from "@/lib/builtin-groups";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../../registry";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { deleteGroup } from "../actions";
import { GroupForm } from "../group-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.edit");
  return { title: t("metaTitle") };
}

type Params = PageProps<"/[locale]/admin/groups/[id]">["params"];

// The header's action: the permissions of this group, for a viewer who may open them.
async function PermissionsAction({ params }: { params: Params }) {
  const groupId = parseId((await params).id);
  const [t, viewer] = await Promise.all([
    getTranslations("adminGroups.edit"),
    getViewer(),
  ]);
  const permissions = hrefFor(viewer, "permissionsGroups");
  if (groupId === null || !permissions) return null;
  return (
    <HeaderLink
      href={`${permissions}/${groupId}`}
      icon={<ShieldCheck aria-hidden="true" />}
    >
      {t("permissions")}
    </HeaderLink>
  );
}

async function Group({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: PageProps<"/[locale]/admin/groups/[id]">["searchParams"];
}) {
  const groupId = parseId((await params).id);
  if (groupId === null) notFound();
  const [t, words, group] = await Promise.all([
    getTranslations("adminGroups.edit"),
    getTranslations("lib.builtinGroups"),
    read(groupsGet, { groupId }),
  ]);
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["created", "saved"]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {inVisitorsLanguage(group, words).title}
        </h2>
        {group.builtin && <Badge variant="secondary">{t("builtin")}</Badge>}
      </div>
      <GroupForm group={group} />
      <ConfirmStep
        action={deleteGroup}
        fields={{ id: group.id }}
        heading={t("deleteHeading")}
        warning={t("deleteWarning")}
        submit={t("delete")}
        password
      />
    </>
  );
}

export default function GroupPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/groups/[id]">) {
  const t = useTranslations("adminGroups.edit");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={params.then(({ id }) => staffTrail(`/admin/groups/${id}`))}
      actions={
        <Suspense fallback={null}>
          <PermissionsAction params={params} />
        </Suspense>
      }
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <Group params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
