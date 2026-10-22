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
import {
  POSITIONS_IN_ORDER,
  pagesDrawn,
  positionDrawn,
  typeDrawn,
} from "./drawn";
import { widgetName } from "./labels";
import { type Position, pagesOf } from "./positions";
import { DeleteStep, DuplicateStep } from "./widget-steps";

// The widgets, one list for each position in the order the pages draw them in (the home page's
// positions, then What's new's, then those no page draws yet); a position with none is a row of the list at the end, to add the first.
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
  const audience = (rule: Rule) => {
    const { audience: kind, groupId } = audienceOf(rule);
    if (kind !== "group") return t(`audiences.${kind}`);
    return t("audiences.group", {
      group:
        groups?.find((group) => group.id === groupId)?.title ?? `#${groupId}`,
    });
  };
  // The pages that draw a position; a position no page draws yet says where it is planned.
  const where = (position: Position) => {
    const drawn = pagesDrawn(position);
    const names = (pages: typeof drawn) =>
      format.list(pages.map((page) => t(`sitePages.${page}`)));
    return drawn.length > 0
      ? t("list.pages", { pages: names(drawn) })
      : t("list.planned", { pages: names(pagesOf(position)) });
  };
  const row = (widget: WidgetItem): Item => {
    const named = widgetName(t, widget);
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
  const empty = POSITIONS_IN_ORDER.filter(
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
      {POSITIONS_IN_ORDER.map((position) => {
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
