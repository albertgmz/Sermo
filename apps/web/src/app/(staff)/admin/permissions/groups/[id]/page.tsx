import { permissionsList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../../../registry";
import { getGroups } from "../../../groups/data";
import { Notice } from "../../../groups/notice";
import { FormSkeleton, PageHead } from "../../../groups/skeletons";
import { entriesOf, getDefinitions, matrixPermissions } from "../../data";
import { PermissionForm } from "../../permission-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionGroup");
  return { title: t("metaTitle") };
}

async function Matrix({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/permissions/groups/[id]">["params"];
  searchParams: PageProps<"/admin/permissions/groups/[id]">["searchParams"];
}) {
  const groupId = parseId((await params).id);
  if (groupId === null) notFound();
  const [t, viewer, groups, definitions, set] = await Promise.all([
    getTranslations("adminGroups.permissionGroup"),
    getViewer(),
    getGroups(),
    getDefinitions(),
    read(permissionsList, { groupId }),
  ]);
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) notFound();
  const edit = hrefFor(viewer, "groupsEdit");
  return (
    <>
      <Notice searchParams={searchParams} shown={["saved"]} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {group.title}
        </h2>
        {edit && (
          <Link
            href={`/admin/groups/${group.id}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 px-4",
            )}
          >
            {t("editGroup")}
          </Link>
        )}
      </div>
      <PermissionForm
        target={{ group: groupId }}
        heading={t("heading")}
        permissions={
          await matrixPermissions(definitions, {
            builtin: group.builtin,
          })
        }
        entries={entriesOf(set)}
      />
    </>
  );
}

export default function PermissionGroupPage({
  params,
  searchParams,
}: PageProps<"/admin/permissions/groups/[id]">) {
  const t = useTranslations("adminGroups.permissionGroup");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={8} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Matrix params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
