import type { promotionsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
import { ConfirmField } from "../groups/confirm-field";
import { getGroups } from "../groups/data";
import { savePromotion } from "./actions";

type Promotion = z.output<typeof promotionsGet.output>;

const checkbox = "size-5";

// The promotion form, for a new rule (no `promotion`) or one being edited. The target groups are
// every group.
export async function PromotionForm({ promotion }: { promotion?: Promotion }) {
  const [t, groups] = await Promise.all([
    getTranslations("adminGroups.promotionForm"),
    getGroups(),
  ]);
  const chosen = new Set(promotion?.groupIds);
  return (
    <EditForm
      action={savePromotion}
      submit={promotion ? undefined : t("create")}
    >
      {promotion && <input type="hidden" name="id" value={promotion.id} />}
      <FieldGroup legend={t("sectionGeneral")}>
        <Field name="title" label={t("title")} htmlFor="promotion-title">
          <Input
            id="promotion-title"
            name="title"
            required
            defaultValue={promotion?.title}
          />
        </Field>
        <Field name="isActive" label={t("isActive")} htmlFor="promotion-active">
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="promotion-active"
              type="checkbox"
              name="isActive"
              defaultChecked={promotion ? promotion.isActive : true}
              className={checkbox}
            />
            {t("isActiveHelp")}
          </label>
        </Field>
        <Field name="groupIds" label={t("groups")} help={t("groupsHelp")}>
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="sr-only">{t("groups")}</legend>
            {groups.map((group) => (
              <label
                key={group.id}
                className="flex min-h-10 items-center gap-3 text-sm"
              >
                <input
                  type="checkbox"
                  name="groupIds"
                  value={group.id}
                  defaultChecked={chosen.has(group.id)}
                  className={checkbox}
                />
                {group.title}
              </label>
            ))}
          </fieldset>
        </Field>
      </FieldGroup>
      <FieldGroup legend={t("sectionRule")}>
        <RuleField
          place="promotion"
          owner={promotion?.id}
          rule={promotion?.rule}
        />
      </FieldGroup>
      <ConfirmField id="promotion-password" />
    </EditForm>
  );
}
