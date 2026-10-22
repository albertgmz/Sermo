import {
  ForumStats,
  STATS_TABS,
} from "@/app/[locale]/(main)/forums/forum-stats";
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
      active={active}
      hrefFor={(tab) =>
        context.href(tab === STATS_TABS[0].value ? [] : [[param, tab]])
      }
      instance={param === "stats" ? null : widget.id}
    />
  );
}
