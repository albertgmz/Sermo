import { Plus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Rule } from "@/components/staff/criteria-rule";
import { type Item, ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { AddLink, SortLink } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { groupsIfAllowed } from "../groups/data";
import { audienceOf } from "../notices/audience";
import { getWidgetList, type WidgetItem } from "./data";
import { type Say, widgetName } from "./labels";
import {
  POSITIONS,
  type Position,
  pagesOf,
  positionDrawn,
  typeDrawn,
} from "./positions";
import { DeleteStep, DuplicateStep } from "./widget-steps";

// The widgets, one list for each position in the order the backend gives them (the order the
// pages draw them in); a position with none is a row of the list at the end, to add the first.
export async function WidgetList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, format, widgets, groups] = await Promise.all([
    getTranslations("adminWidgets"),
    getFormatter(),
    getWidgetList(),
    groupsIfAllowed(),
  ]);
  const say = t as unknown as Say;
  const audience = (rule: Rule) => {
    const { audience: kind, groupId } = audienceOf(rule);
    if (kind !== "group") return t(`audiences.${kind}`);
    return t("audiences.group", {
      group:
        groups?.find((group) => group.id === groupId)?.title ?? `#${groupId}`,
    });
  };
  const where = (position: Position) =>
    t("list.pages", {
      pages: format.list(
        pagesOf(position).map((page) => t(`sitePages.${page}`)),
      ),
    });
  const row = (widget: WidgetItem): Item => {
    const named = widgetName(say, widget);
    const title = widget.title ?? named;
    return {
      id: widget.id,
      title,
      href: `/admin/widgets/${widget.id}`,
      description: [widget.title !== null && named, audience(widget.rule)]
        .filter(Boolean)
        .join(" · "),
      search: `${title} ${named}`,
      badges: (
        <>
          {!widget.isEnabled && <Badge variant="outline">{t("row.off")}</Badge>}
          {!widget.phones && (
            <Badge variant="secondary">{t("row.noPhones")}</Badge>
          )}
          {!(typeDrawn(widget.type) && positionDrawn(widget.position)) && (
            <Badge variant="outline">{t("row.notShown")}</Badge>
          )}
        </>
      ),
      actions: (
        <>
          <RowLink
            href={`/admin/widgets/${widget.id}`}
            label={t("row.edit", { title })}
          />
          <DuplicateStep widget={widget} />
          <DeleteStep widget={widget} />
        </>
      ),
    };
  };
  const empty = POSITIONS.filter(
    (position) => !widgets.some((widget) => widget.position === position),
  );
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          deleted: t("notices.deleted"),
          ordered: t("notices.ordered"),
        }}
      />
      {POSITIONS.map((position) => {
        const here = widgets.filter((widget) => widget.position === position);
        if (here.length === 0) return null;
        const title = t(`positions.${position}`);
        return (
          <ItemList
            key={position}
            label={t("list.label", { position: title })}
            heading={
              <>
                {title}
                {!positionDrawn(position) && (
                  <Badge variant="outline" className="ms-2">
                    {t("row.notShown")}
                  </Badge>
                )}
              </>
            }
            description={where(position)}
            action={
              <div className="flex flex-wrap gap-2">
                {here.length > 1 && (
                  <SortLink href={`/admin/widgets/sort?position=${position}`}>
                    {t("list.sort")}
                  </SortLink>
                )}
                <AddLink
                  href={`/admin/widgets/new?position=${position}`}
                  secondary
                >
                  {t("list.addHere")}
                </AddLink>
              </div>
            }
            items={here.map(row)}
            filter={here.length > 5}
            empty={{ title: t("list.emptyPosition") }}
          />
        );
      })}
      {empty.length > 0 && (
        <ItemList
          label={t("list.emptyLabel")}
          heading={t("list.emptyHeading")}
          description={t("list.emptyDescription")}
          items={empty.map((position) => ({
            id: position,
            title: t(`positions.${position}`),
            description: where(position),
            actions: (
              <RowLink
                href={`/admin/widgets/new?position=${position}`}
                label={t("list.addTo", {
                  position: t(`positions.${position}`),
                })}
                icon={<Plus aria-hidden="true" />}
              />
            ),
          }))}
          empty={{ title: t("list.emptyHeading") }}
        />
      )}
    </>
  );
}
