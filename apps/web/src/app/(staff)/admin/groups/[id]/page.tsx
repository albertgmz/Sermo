import { groupsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../../registry";
import { deleteGroup } from "../actions";
import { ConfirmDelete } from "../confirm-delete";
import { GroupForm } from "../group-form";
import { Notice } from "../notice";
import { FormSkeleton, PageHead } from "../skeletons";

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
      <Notice searchParams={searchParams} shown={["created", "saved"]} />
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
      <ConfirmDelete
        action={deleteGroup}
        id={group.id}
        summary={t("deleteHeading")}
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
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Group params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
