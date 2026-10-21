import type { StatsTab } from "@/app/[locale]/(main)/forums/forum-stats";
import type { ApiWidget } from "@/lib/sermo/widgets";

export type WidgetType = ApiWidget["type"];

// A widget of one type, with that type's options.
export type WidgetOf<K extends WidgetType> = Extract<ApiWidget, { type: K }>;

// What the page a widget is drawn on tells it: the forum statistics tab chosen in the address, and
// the page's own address of each tab.
export type WidgetContext = {
  stats: StatsTab;
  statsHref: (tab: StatsTab) => string;
};

// What a widget's body is given: the widget, its title (the one it was given, else its type's)
// and the page's context.
export type WidgetBodyProps<K extends WidgetType> = {
  widget: WidgetOf<K>;
  title: string;
  context: WidgetContext;
};
