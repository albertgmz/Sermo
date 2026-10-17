import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { iconComponent } from "@/components/icons/icon-set";
import { SortForm } from "@/components/staff/sort-form";
import { saveOrder } from "./actions";
import { getEntries } from "./data";

// One form for each group of entries that are ordered against each other: the top-level entries
// of a place, and the entries under one heading. A group of one has nothing to order.
export async function SortLists() {
  const [t, entries] = await Promise.all([
    getTranslations("adminSetup.navigation"),
    getEntries(),
  ]);
  const item = (entry: (typeof entries)[number]) => {
    const Icon = iconComponent(entry.icon);
    return {
      id: entry.id,
      title: entry.title,
      position: entry.position,
      icon: Icon && <Icon aria-hidden="true" className="size-5" />,
    };
  };
  const groups = [...new Set(entries.map((entry) => entry.location))].flatMap(
    (location) => {
      const place = t(`locations.${location}`);
      const tops = entries.filter(
        (entry) => entry.location === location && entry.parentId === null,
      );
      return [
        { id: location, heading: place, members: tops },
        ...tops.map((top) => ({
          id: `${location}:${top.id}`,
          heading: t("sort.under", { parent: top.title, place }),
          members: entries.filter((entry) => entry.parentId === top.id),
        })),
      ];
    },
  );
  const orderable = groups.filter((group) => group.members.length > 1);
  if (orderable.length === 0) {
    return (
      <EmptyState
        title={t("sort.none")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return (
    <>
      {orderable.map((group) => (
        <SortForm
          key={group.id}
          action={saveOrder}
          name="position.{id}"
          heading={group.heading}
          items={group.members.map(item)}
        />
      ))}
    </>
  );
}
