import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../../groups/skeletons";
import { SettingsNotice } from "../settings-screen";
import { AddForm } from "./add-form";
import { getEntries, globalPermissions } from "./data";
import { Entries, type Item, type Place } from "./entries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.navigation");
  return { title: t("metaTitle") };
}

async function Editor({
  searchParams,
}: {
  searchParams: PageProps<"/admin/settings/navigation">["searchParams"];
}) {
  const [t, entries, permissions] = await Promise.all([
    getTranslations("adminSetup.navigation"),
    getEntries(),
    globalPermissions(),
  ]);
  const item = (
    entry: (typeof entries)[number],
    children: (typeof entries)[number][],
  ): Item => ({
    id: entry.id,
    title: entry.title,
    target: entry.target,
    builtin: entry.builtin !== null,
    isEnabled: entry.isEnabled,
    audience: entry.audience,
    permission: entry.permission,
    icon: entry.icon,
    iconPosition: entry.iconPosition,
    position: entry.position,
    children: children.length,
    enabledChildren: children.filter((child) => child.isEnabled).length,
  });
  // The list comes ordered by place, parents before their children, position and id: each place
  // keeps the order it arrives in.
  const locations = [...new Set(entries.map((entry) => entry.location))];
  const places: Place[] = locations.map((location) => ({
    location,
    label: t(`locations.${location}`),
    tree: entries
      .filter((entry) => entry.location === location && entry.parentId === null)
      .map((entry) => {
        const children = entries.filter((child) => child.parentId === entry.id);
        return {
          entry: item(entry, children),
          children: children.map((child) => item(child, [])),
        };
      }),
  }));
  return (
    <div className="space-y-4">
      <SettingsNotice searchParams={searchParams} />
      <AddForm entries={entries} permissions={permissions} />
      <Entries places={places} permissions={permissions} />
    </div>
  );
}

export default function NavigationPage({
  searchParams,
}: PageProps<"/admin/settings/navigation">) {
  const t = useTranslations("adminSetup.pages.navigation");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <FormSkeleton />
              <ListSkeleton rows={8} />
            </div>
          </LoadingRegion>
        }
      >
        <Editor searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
