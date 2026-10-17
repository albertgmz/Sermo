import type { forumTabsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { saveTab } from "../actions";

export type Tab = z.output<typeof forumTabsList.output>["items"][number];

// The form of a forum list tab, for a new one (no `tab`) or a change. A tab is given to a root
// category in that category's own editor.
export async function TabForm({ tab }: { tab?: Tab }) {
  const t = await getTranslations("adminForums.tabForm");
  return (
    <EditForm action={saveTab} submit={tab ? undefined : t("create")}>
      {tab && <input type="hidden" name="id" value={tab.id} />}
      <FieldGroup legend={t("legend")}>
        <Field name="title" label={t("title")} htmlFor="tab-title">
          <Input
            id="tab-title"
            name="title"
            required
            defaultValue={tab?.title}
          />
        </Field>
        <Field
          name="position"
          label={t("position")}
          htmlFor="tab-position"
          help={t("positionHelp")}
        >
          <Input
            id="tab-position"
            name="position"
            type="number"
            inputMode="numeric"
            defaultValue={tab?.position}
          />
        </Field>
      </FieldGroup>
    </EditForm>
  );
}
