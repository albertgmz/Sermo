import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton } from "../../../groups/skeletons";
import { getEntries, globalPermissions } from "../data";
import { EntryForm } from "../entry-form";
import { navigationTrail } from "../navigation-trail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.navigation.edit");
  return { title: t("metaTitle") };
}

async function Entry({
  params,
}: {
  params: PageProps<"/[locale]/admin/settings/navigation/[id]">["params"];
}) {
  const entryId = parseId((await params).id);
  if (entryId === null) notFound();
  const [t, entries, permissions] = await Promise.all([
    getTranslations("adminSetup.navigation"),
    getEntries(),
    globalPermissions(),
  ]);
  const entry = entries.find((other) => other.id === entryId);
  if (!entry) notFound();
  return (
    <>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">
        {t("edit.about", {
          title: entry.title,
          place: t(`locations.${entry.location}`),
        })}
      </p>
      <EntryForm entries={entries} permissions={permissions} entry={entry} />
    </>
  );
}

export default function EditEntryPage({
  params,
}: PageProps<"/[locale]/admin/settings/navigation/[id]">) {
  const t = useTranslations("adminSetup.navigation.edit");
  const page = useTranslations("adminSetup.pages.navigation");
  return (
    <ScreenFrame
      trail={params.then(({ id }) =>
        navigationTrail(`/admin/settings/navigation/${id}`),
      )}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={page("loading")}
      fallback={<FormSkeleton />}
    >
      <Entry params={params} />
    </ScreenFrame>
  );
}
