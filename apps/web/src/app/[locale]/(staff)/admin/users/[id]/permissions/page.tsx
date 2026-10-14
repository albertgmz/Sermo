import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/staff/rows";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { memberIdOf } from "../../data";
import { TabPage } from "../../tab-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.permissions");
  return { title: t("metaTitle") };
}

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

async function Permissions({
  params,
}: {
  params: PageProps<"/[locale]/admin/users/[id]/permissions">["params"];
}) {
  const [t, userId] = await Promise.all([
    getTranslations("adminUsers.permissions"),
    memberIdOf(params),
  ]);
  return (
    <Section heading={t("heading")} description={t("description")}>
      <div className="flex flex-wrap gap-3 p-4">
        <Link href={`/admin/permissions/members/${userId}`} className={link}>
          {t("edit")}
        </Link>
        <Link
          href={`/admin/permissions/explain?user=${userId}`}
          className={link}
        >
          {t("analyse")}
        </Link>
      </div>
    </Section>
  );
}

export default function MemberPermissionsPage({
  params,
}: PageProps<"/[locale]/admin/users/[id]/permissions">) {
  const t = useTranslations("adminUsers.permissions");
  return (
    <TabPage label={t("loading")} rows={1}>
      <Permissions params={params} />
    </TabPage>
  );
}
