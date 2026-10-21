import type { WidgetPosition } from "@sermo/core/contracts";
import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import type * as z from "zod";
import { LoadingRegion } from "@/components/forum/skeletons";
import {
  WIDGET_ENTRIES,
  type WidgetEntry,
} from "@/components/widgets/registry";
import type {
  WidgetContext,
  WidgetType,
} from "@/components/widgets/widget-types";
import type { ApiWidget } from "@/lib/sermo/widgets";
import { cn } from "@/lib/utils";

type Position = z.output<typeof WidgetPosition>;

// The areas of the two pages that draw widgets, each with its positions in drawing order (the
// backend's list is already in that order). `lead` spans both columns above them; `above` and
// `below` sit in the main column around the page's own content; `aside` is the sidebar, which opens
// and closes with the two global positions.
const AREAS = {
  home: {
    lead: ["overview_top"],
    above: ["forum_list_above"],
    below: ["forum_list_below", "overview_bottom"],
    aside: ["sidebar_top", "forum_list_sidebar", "sidebar_bottom"],
  },
  novedades: {
    lead: ["overview_top"],
    above: ["novedades_above"],
    below: ["overview_bottom"],
    aside: ["sidebar_top", "novedades_sidebar", "sidebar_bottom"],
  },
} as const satisfies Record<
  string,
  Record<"lead" | "above" | "below" | "aside", readonly Position[]>
>;

export type WidgetAreas = Record<keyof (typeof AREAS)["home"], ApiWidget[]>;

// A page's widgets, sorted into its areas.
export function widgetAreas(
  page: keyof typeof AREAS,
  widgets: readonly ApiWidget[],
): WidgetAreas {
  const of = (positions: readonly Position[]) =>
    widgets.filter((widget) => positions.includes(widget.position));
  const areas = AREAS[page];
  return {
    lead: of(areas.lead),
    above: of(areas.above),
    below: of(areas.below),
    aside: of(areas.aside),
  };
}

// The page's sidebar, as `PageLayout` takes it: no column at all when no widget is in it, and none
// on a phone when no widget in it is drawn there. Below the content it lays its blocks out in two
// columns until the screen is wide enough for the sidebar to stand beside the content.
export function widgetAside(widgets: ApiWidget[], context: WidgetContext) {
  if (widgets.length === 0) return {};
  return {
    aside: <WidgetArea widgets={widgets} context={context} />,
    asideClassName: cn(
      "sm:grid-cols-2 sm:items-start lg:grid-cols-1",
      widgets.every((widget) => !widget.phones) && "max-md:hidden",
    ),
  };
}

// Widgets one after another, in the order given. Each loads on its own, so a slow one holds back
// no other.
export function WidgetArea({
  widgets,
  context,
}: {
  widgets: readonly ApiWidget[];
  context: WidgetContext;
}) {
  return widgets.map((widget) => (
    <WidgetSlot key={widget.id} widget={widget} context={context} />
  ));
}

// The default title of a widget: its type's, and for a thread list the list's.
const titleKey = (widget: ApiWidget) =>
  widget.type === "rankedThreads" ? widget.options.by : widget.type;

function WidgetSlot({
  widget,
  context,
}: {
  widget: ApiWidget;
  context: WidgetContext;
}) {
  const t = useTranslations("widgets.widgetArea");
  const entry = WIDGET_ENTRIES[widget.type] as
    | WidgetEntry<WidgetType>
    | undefined;
  if (!entry) return null;
  const title = widget.title ?? t(`titles.${titleKey(widget)}` as never);
  const Skeleton = entry.Skeleton;
  const slot = (
    <Suspense
      fallback={
        Skeleton ? (
          <LoadingRegion label={t("loading", { title })}>
            <Skeleton widget={widget} />
          </LoadingRegion>
        ) : null
      }
    >
      <Drawn entry={entry} widget={widget} title={title} context={context} />
    </Suspense>
  );
  // A widget kept off phones is hidden there; the wrapper itself is hidden while it holds nothing,
  // so an empty block leaves no gap.
  return widget.phones ? (
    slot
  ) : (
    <div className="empty:hidden max-md:hidden">{slot}</div>
  );
}

// One widget that fails draws nothing and is logged; the page and the other widgets stand. What
// Next.js throws on purpose (a redirect, a request-time read during a prerender) is passed on.
async function Drawn({
  entry,
  widget,
  title,
  context,
}: {
  entry: WidgetEntry<WidgetType>;
  widget: ApiWidget;
  title: string;
  context: WidgetContext;
}) {
  try {
    return await entry.Body({ widget, title, context });
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `The ${widget.type} widget ${widget.id} could not be drawn`,
      error,
    );
    return null;
  }
}
