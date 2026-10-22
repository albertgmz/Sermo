import type { getTranslations } from "next-intl/server";
import type { WidgetItem } from "./data";

type Words = Awaited<ReturnType<typeof getTranslations<"adminWidgets">>>;

// What a widget is called when it has no title of its own: its type's name, and for a thread list
// the list it shows.
export function widgetName(t: Words, widget: WidgetItem) {
  return widget.type === "rankedThreads"
    ? t(`optionValues.${widget.options.by}`)
    : t(`types.${widget.type}.name`);
}
