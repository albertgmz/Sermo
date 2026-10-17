import { staffAdministrators } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { read } from "@/lib/sermo/client";
import { getDefinitions } from "../../permissions/data";
import { StaffList } from "../staff-list";

// Every member holding an administration permission, with the ones they hold.
export async function AdministratorList() {
  const [t, definitions, { items }] = await Promise.all([
    getTranslations("adminGroups.administrators"),
    getDefinitions(),
    read(staffAdministrators, {}),
  ]);
  const titles = new Map(
    definitions.map((definition) => [definition.id, definition.title]),
  );
  return (
    <StaffList
      items={items}
      heading={t("heading")}
      permissions={(name) => t("permissions", { name })}
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      detail={(item) => (
        <ul aria-label={t("holds")} className="flex flex-wrap gap-1.5 pb-2">
          {item.permissions.map((id) => (
            <li
              key={id}
              title={id}
              className="rounded-sm border px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]"
            >
              {titles.get(id) ?? id}
            </li>
          ))}
        </ul>
      )}
    />
  );
}
