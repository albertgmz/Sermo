import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { SortForm } from "@/components/staff/sort-form";
import { saveOrder } from "./actions";
import { getWidgetList } from "./data";
import { POSITIONS_IN_ORDER } from "./drawn";
import { widgetName } from "./labels";
import type { Position } from "./positions";

// One form for each position with more than one widget (or the one position asked for), the
// widgets in the order the pages draw them. The numbers are the stored order, so the form sends
// the new order as numbers (`order.<id>`) with the position it is for.
export async function SortLists({ position }: { position?: Position }) {
  const [t, widgets] = await Promise.all([
    getTranslations("adminWidgets"),
    getWidgetList(),
  ]);
  const orderable = (position ? [position] : POSITIONS_IN_ORDER).filter(
    (place) => widgets.filter((widget) => widget.position === place).length > 1,
  );
  if (orderable.length === 0) {
    return (
      <EmptyState
        title={t("sort.none")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return orderable.map((place) => (
    <SortForm
      key={place}
      action={saveOrder}
      name="order.{id}"
      heading={t(`positions.${place}`)}
      items={widgets
        .filter((widget) => widget.position === place)
        .map((widget) => ({
          id: widget.id,
          title: widget.title ?? widgetName(t, widget),
          position: widget.displayOrder,
          description: widget.title !== null && widgetName(t, widget),
          fields: { position: place },
        }))}
    />
  ));
}
