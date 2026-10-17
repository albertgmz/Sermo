import { getTranslations } from "next-intl/server";
import { iconComponent } from "@/components/icons/icon-set";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { type Item, ItemList, RowLink } from "@/components/staff/item-list";
import { Badge } from "@/components/ui/badge";
import { deleteEntry } from "./actions";
import { getEntries } from "./data";

// The navigation entries, one list for each place: a top-level entry, then the entries under it.
// Each row leads to the entry's own page; the delete step is on the row.
export async function EntryList() {
  const [t, entries] = await Promise.all([
    getTranslations("adminSetup.navigation"),
    getEntries(),
  ]);
  const row = (
    entry: (typeof entries)[number],
    parent: (typeof entries)[number] | undefined,
  ): Item => {
    const children = entries.filter((child) => child.parentId === entry.id);
    const Icon = iconComponent(entry.icon);
    // A heading, or an entry with children, that shows nothing to anyone.
    const empty =
      !parent &&
      (entry.target === null || children.length > 0) &&
      !children.some((child) => child.isEnabled);
    return {
      id: entry.id,
      icon: Icon && <Icon aria-hidden="true" className="size-5" />,
      title: entry.title,
      href: `/admin/settings/navigation/${entry.id}`,
      description: [
        parent && t("list.inside", { parent: parent.title }),
        entry.target === null
          ? t("row.heading")
          : t("row.target", { target: entry.target }),
      ]
        .filter(Boolean)
        .join(" · "),
      badges: (
        <>
          {entry.builtin !== null && (
            <Badge variant="secondary">{t("row.builtin")}</Badge>
          )}
          {!entry.isEnabled && (
            <Badge variant="outline">{t("row.disabled")}</Badge>
          )}
        </>
      ),
      actions: (
        <>
          <RowLink
            href={`/admin/settings/navigation/${entry.id}`}
            label={t("list.edit", { title: entry.title })}
          />
          {entry.builtin === null && (
            <ConfirmStep
              action={deleteEntry}
              fields={{ id: String(entry.id) }}
              summary={t("row.delete")}
              warning={t("row.deleteWarning", { title: entry.title })}
              submit={t("row.deleteConfirm")}
            />
          )}
        </>
      ),
      panel: empty && (
        <p className="pb-2 text-xs text-muted-foreground">
          {t("row.noChildren")}
        </p>
      ),
    };
  };
  // The list comes ordered by place, parents before their children, position and id: each place
  // keeps the order it arrives in.
  const locations = [...new Set(entries.map((entry) => entry.location))];
  if (locations.length === 0) {
    return (
      <ItemList
        label={t("list.label")}
        items={[]}
        empty={{ title: t("row.empty") }}
      />
    );
  }
  return (
    <>
      {locations.map((location) => {
        const label = t(`locations.${location}`);
        const items = entries
          .filter((top) => top.location === location && top.parentId === null)
          .flatMap((top) => [
            row(top, undefined),
            ...entries
              .filter((child) => child.parentId === top.id)
              .map((child) => row(child, top)),
          ]);
        return (
          <ItemList
            key={location}
            label={t("list.placeLabel", { place: label })}
            heading={label}
            items={items}
            filter
            empty={{ title: t("row.empty") }}
          />
        );
      })}
    </>
  );
}
