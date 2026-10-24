import {
  ForumStats,
  STATS_TABS,
} from "@/app/[locale]/(main)/forums/forum-stats";
import { placeOfQuery } from "@/components/forum/places";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";

// The address parameter that keeps a forum statistics widget's tab: `stats` for the first one the
// page draws (the address the forum list has always used), `stats-<id>` for any other, so that two
// of them on one page keep their own tab and their own open or closed state.
export function statsParam(
  widget: WidgetBodyProps<"forumStats">["widget"],
  widgets: WidgetBodyProps<"forumStats">["context"]["widgets"],
) {
  const first = widgets.find((each) => each.type === "forumStats");
  return !first || first.id === widget.id ? "stats" : `stats-${widget.id}`;
}

// Whether a position is drawn in a page's sidebar (each page's own and the two global ones).
const inSidebar = (position: string) =>
  position.endsWith("_sidebar") ||
  position.startsWith("sidebar_") ||
  position === "members_sidenav";

// The positions drawn above both columns of their page.
const LEADS = new Set(["overview_top", "forum_list_top"]);

// Whether the panel can be wide enough for the top posters column (72rem): only across the whole
// page, as a lead above both columns or in a main column with no sidebar beside it. Elsewhere the
// column would never show, so its members are not read.
export function spansPage(
  widget: WidgetBodyProps<"forumStats">["widget"],
  widgets: WidgetBodyProps<"forumStats">["context"]["widgets"],
) {
  if (LEADS.has(widget.position)) return true;
  if (inSidebar(widget.position)) return false;
  return !widgets.some((each) => inSidebar(each.position));
}

export function ForumStatsWidget({
  widget,
  title,
  context,
}: WidgetBodyProps<"forumStats">) {
  const param = statsParam(widget, context.widgets);
  const chosen = context.params[param];
  const active =
    STATS_TABS.find((entry) => entry.value === chosen)?.value ??
    STATS_TABS[0].value;
  return (
    <ForumStats
      title={title}
      limit={widget.options.limit}
      topPosters={
        widget.options.topPosters && spansPage(widget, context.widgets)
      }
      active={active}
      hrefFor={(tab) =>
        context.href(tab === STATS_TABS[0].value ? [] : [[param, tab]])
      }
      instance={param === "stats" ? null : widget.id}
      param={param}
      place={placeOfQuery(context.params, [param])}
      path={new URL(context.href([]), "http://page.invalid").pathname}
    />
  );
}
