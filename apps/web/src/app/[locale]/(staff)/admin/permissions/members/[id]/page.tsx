import { permissionsList, usersCards } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton } from "../../../groups/skeletons";
import { entriesOf, getDefinitions, matrixPermissions } from "../../data";
import { MatrixHead } from "../../matrix-head";
import { PermissionForm } from "../../permission-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionMember");
  return { title: t("metaTitle") };
}

async function Matrix({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/permissions/members/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/permissions/members/[id]">["searchParams"];
}) {
  const userId = parseId((await params).id);
  if (userId === null) notFound();
  const [t, definitions, set, cards] = await Promise.all([
    getTranslations("adminGroups.permissionMember"),
    getDefinitions(),
    read(permissionsList, { userId }),
    read(usersCards, { userIds: [userId] }),
  ]);
  const member = cards.items[0];
  if (!member) notFound();
  return (
    <>
      <MatrixHead
        searchParams={searchParams}
        title={member.username}
        link={{
          href: `/admin/permissions/explain?user=${userId}`,
          label: t("analyse"),
        }}
      />
      <PermissionForm
        target={{ user: userId }}
        heading={t("heading")}
        permissions={await matrixPermissions(definitions)}
        entries={entriesOf(set)}
      />
    </>
  );
}

export default function PermissionMemberPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/permissions/members/[id]">) {
  const t = useTranslations("adminGroups.permissionMember");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={8} />}
    >
      <Matrix params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
