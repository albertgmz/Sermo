import { getTranslations } from "next-intl/server";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import type { GroupItem } from "../../../groups/data";
import { saveGroups } from "./actions";

type Held = {
  primaryGroupId: number;
  secondaryGroupIds: number[];
  promotionGroupIds: number[];
  purchasedGroupIds: number[];
};

// The primary group as a select and the secondary groups as a grid of checkboxes. A membership
// that comes from a promotion or a purchase is shown with its origin and cannot be changed here.
export async function GroupsForm({
  userId,
  groups,
  held,
  readOnly,
}: {
  userId: number;
  groups: GroupItem[];
  held: Held;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.groups");
  // The guest group cannot be assigned.
  const assignable = groups.filter((group) => group.builtin !== "guest");
  return (
    <FormRows
      key={JSON.stringify(held)}
      action={saveGroups}
      heading={t("heading")}
      description={t("description")}
      disabled={readOnly}
    >
      <input type="hidden" name="id" value={userId} />
      <ConfirmPassword />
      <FieldRow
        name="primaryGroupId"
        label={t("primary")}
        htmlFor="member-primary-group"
      >
        <select
          id="member-primary-group"
          name="primaryGroupId"
          defaultValue={held.primaryGroupId}
          className={selectClass}
        >
          {assignable.map((group) => (
            <option key={group.id} value={group.id}>
              {group.title}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="secondary"
        label={t("secondary")}
        help={t("secondaryHelp")}
      >
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {assignable.map((group) => {
            const manual = held.secondaryGroupIds.includes(group.id);
            const promoted = held.promotionGroupIds.includes(group.id);
            const bought = held.purchasedGroupIds.includes(group.id);
            const fixed = !manual && (promoted || bought);
            return (
              <li key={group.id}>
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="secondary"
                    value={group.id}
                    defaultChecked={manual || fixed}
                    disabled={fixed}
                    className="size-5"
                  />
                  <span className="[overflow-wrap:anywhere]">
                    {group.title}
                  </span>
                  {manual && (
                    <Badge variant="secondary">{t("origin.manual")}</Badge>
                  )}
                  {promoted && (
                    <Badge variant="outline">{t("origin.promotion")}</Badge>
                  )}
                  {bought && (
                    <Badge variant="outline">{t("origin.purchased")}</Badge>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </FieldRow>
    </FormRows>
  );
}
