import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { selectClass } from "@/components/staff/rows";
import { duplicateWidget, removeWidget } from "./actions";
import type { WidgetItem } from "./data";
import { POSITIONS_IN_ORDER } from "./drawn";
import { widgetName } from "./labels";

// The two steps behind a widget, on its row of the list and on its own page: a copy to the end of
// a position, and the delete.
export async function DuplicateStep({ widget }: { widget: WidgetItem }) {
  const t = await getTranslations("adminWidgets");
  const id = `widget-${widget.id}-copy`;
  return (
    <ConfirmStep
      action={duplicateWidget}
      fields={{ id: widget.id }}
      summary={t("steps.duplicate")}
      warning={t("steps.duplicateWarning")}
      submit={t("steps.duplicateConfirm")}
      danger={false}
    >
      <div className="grid gap-1.5">
        <label htmlFor={id} className="text-xs font-medium">
          {t("steps.duplicatePosition")}
        </label>
        <select
          id={id}
          name="position"
          defaultValue={widget.position}
          className={selectClass}
        >
          {POSITIONS_IN_ORDER.map((place) => (
            <option key={place} value={place}>
              {t(`positions.${place}`)}
            </option>
          ))}
        </select>
      </div>
    </ConfirmStep>
  );
}

export async function DeleteStep({
  widget,
  heading,
}: {
  widget: WidgetItem;
  heading?: string;
}) {
  const t = await getTranslations("adminWidgets");
  return (
    <ConfirmStep
      heading={heading}
      action={removeWidget}
      fields={{ id: widget.id }}
      summary={t("steps.delete")}
      warning={t("steps.deleteWarning", {
        title: widget.title ?? widgetName(t, widget),
      })}
      submit={t("steps.deleteConfirm")}
    />
  );
}
