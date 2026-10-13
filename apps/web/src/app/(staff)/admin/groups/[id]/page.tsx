import { groupsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../../registry";
import { deleteGroup } from "../actions";
import { GroupForm } from "../group-form";
import { FormSkeleton } from "../skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.edit");
  return { title: t("metaTitle") };
}

async function Group({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/groups/[id]">["params"];
  searchParams: PageProps<"/admin/groups/[id]">["searchParams"];
}) {
  const groupId = parseId((await params).id);
  if (groupId === null) notFound();
  const [t, viewer, group] = await Promise.all([
    getTranslations("adminGroups.edit"),
    getViewer(),
    read(groupsGet, { groupId }),
  ]);
  const permissions = hrefFor(viewer, "permissionsGroups");
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["created", "saved"]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {group.title}
        </h2>
        {group.builtin && <Badge variant="secondary">{t("builtin")}</Badge>}
        {permissions && (
          <Link
            href={`${permissions}/${group.id}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 px-4",
            )}
          >
            {t("permissions")}
          </Link>
        )}
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
}: PageProps<"/admin/groups/[id]">) {
  const t = useTranslations("adminGroups.edit");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <Group params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
