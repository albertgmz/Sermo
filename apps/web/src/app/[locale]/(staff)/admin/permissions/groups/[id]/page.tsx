import { permissionsList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../../../registry";
import { staffTrail } from "../../../../trail";
import { getGroups } from "../../../groups/data";
import { FormSkeleton } from "../../../groups/skeletons";
import { entriesOf, getDefinitions, matrixPermissions } from "../../data";
import { MatrixHead } from "../../matrix-head";
import { PermissionForm } from "../../permission-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionGroup");
  return { title: t("metaTitle") };
}

async function Matrix({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/permissions/groups/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/permissions/groups/[id]">["searchParams"];
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
      <MatrixHead
        searchParams={searchParams}
        title={group.title}
        link={
          edit
            ? { href: `/admin/groups/${group.id}`, label: t("editGroup") }
            : undefined
        }
      />
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
}: PageProps<"/[locale]/admin/permissions/groups/[id]">) {
  const t = useTranslations("adminGroups.permissionGroup");
  return (
    <ScreenFrame
      trail={params.then(({ id }) =>
        staffTrail(`/admin/permissions/groups/${id}`),
      )}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={8} />}
    >
      <Matrix params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
