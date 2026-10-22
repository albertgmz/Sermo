import type { ApiWidget } from "@/lib/sermo/widgets";

export type WidgetType = ApiWidget["type"];

// A widget of one type, with that type's options.
export type WidgetOf<K extends WidgetType> = Extract<ApiWidget, { type: K }>;

// What the page a widget is drawn on tells it, for a widget that keeps a choice in the address (the
// forum statistics tab):
//   params   The page's address parameters.
//   href     The page's own address as it stands (from its first page), with `query` set on it.
//   widgets  Every widget the page draws, so that two of a kind can tell themselves apart.
export type WidgetContext = {
  params: Record<string, string | string[] | undefined>;
  href: (query: [string, string][]) => string;
  widgets: readonly ApiWidget[];
};

// What a widget's body is given: the widget, its title (the one it was given, else its type's)
// and the page's context.
export type WidgetBodyProps<K extends WidgetType> = {
  widget: WidgetOf<K>;
  title: string;
  context: WidgetContext;
};
