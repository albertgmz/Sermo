import { permissionsList, usersCards } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { Notice } from "../../../groups/notice";
import { FormSkeleton, PageHead } from "../../../groups/skeletons";
import { entriesOf, getDefinitions, matrixPermissions } from "../../data";
import { PermissionForm } from "../../permission-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionMember");
  return { title: t("metaTitle") };
}

async function Matrix({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/permissions/members/[id]">["params"];
  searchParams: PageProps<"/admin/permissions/members/[id]">["searchParams"];
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
      <Notice searchParams={searchParams} shown={["saved"]} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          <UserLink user={member} />
        </h2>
        <Link
          href={`/admin/permissions/explain?user=${userId}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-10 px-4",
          )}
        >
          {t("analyse")}
        </Link>
      </div>
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
}: PageProps<"/admin/permissions/members/[id]">) {
  const t = useTranslations("adminGroups.permissionMember");
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
