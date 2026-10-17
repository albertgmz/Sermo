import { getTranslations } from "next-intl/server";
import { Field } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";

// The fields a word filter is written with. `filter` is the one being edited: its word is shown
// but not changed, as the backend keys filters by word. Without it the fields start empty (active).
export async function FilterFields({
  filter,
}: {
  filter?: {
    term: string;
    action: "replace" | "moderate";
    replacement: string | null;
    isActive: boolean;
  };
}) {
  const t = await getTranslations("adminContent.wordFilters");
  return (
    <>
      <Field
        name="term"
        label={t("create.term")}
        htmlFor="filter-term"
        help={filter ? t("edit.termHelp") : t("create.termHelp")}
      >
        <Input
          id="filter-term"
          name="term"
          required
          readOnly={filter !== undefined}
          defaultValue={filter?.term}
          aria-describedby="filter-term-help"
        />
      </Field>
      <Field
        name="action"
        label={t("create.action")}
        htmlFor="filter-action"
        help={t("create.actionHelp")}
      >
        <select
          id="filter-action"
          name="action"
          defaultValue={filter?.action ?? "replace"}
          aria-describedby="filter-action-help"
          className={selectClass}
        >
          <option value="replace">{t("row.replace")}</option>
          <option value="moderate">{t("row.moderate")}</option>
        </select>
      </Field>
      <Field
        name="replacement"
        label={t("create.replacement")}
        htmlFor="filter-replacement"
        help={t("create.replacementHelp")}
      >
        <Input
          id="filter-replacement"
          name="replacement"
          defaultValue={filter?.replacement ?? ""}
          aria-describedby="filter-replacement-help"
        />
      </Field>
      <Field name="isActive" label={t("create.active")} htmlFor="filter-active">
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id="filter-active"
            type="checkbox"
            name="isActive"
            defaultChecked={filter?.isActive ?? true}
            className="size-5"
          />
          {t("create.activeSwitch")}
        </label>
      </Field>
    </>
  );
}
