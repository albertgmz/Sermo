import type { WidgetItem } from "./data";

export type Say = (
  key: string,
  values?: Record<string, string | number>,
) => string;

// What a widget is called when it has no title of its own: its type's name, and for a thread list
// the list it shows.
export function widgetName(say: Say, widget: WidgetItem) {
  return widget.type === "rankedThreads"
    ? say(`optionValues.${widget.options.by}`)
    : say(`types.${widget.type}.name`);
}
