import { WidgetKind } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { ItemList } from "@/components/staff/item-list";
import { Badge } from "@/components/ui/badge";
import type { Position } from "./positions";
import { typeDrawn } from "./positions";

// The first step of adding a widget: its type, each a link to the form for it (carrying the
// position chosen on the list, if any).
export async function TypeChoice({ position }: { position?: Position }) {
  const t = await getTranslations("adminWidgets");
  return (
    <ItemList
      label={t("new.typeLabel")}
      heading={t("new.typeHeading")}
      description={t("new.typeDescription")}
      items={WidgetKind.options.map((type) => ({
        id: type,
        title: t(`types.${type}.name`),
        href: `/admin/widgets/new?${new URLSearchParams({
          type,
          ...(position && { position }),
        })}`,
        description: t(`types.${type}.help`),
        badges: !typeDrawn(type) && (
          <Badge variant="outline">{t("row.notShown")}</Badge>
        ),
      }))}
      empty={{ title: t("new.typeHeading") }}
    />
  );
}
