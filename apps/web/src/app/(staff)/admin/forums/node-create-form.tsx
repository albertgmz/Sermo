import type { forumTabsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { IconPicker } from "@/components/icons/icon-picker";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createNode } from "./actions";
import { NodeOptions, type TreeNode } from "./node-options";

type Tab = z.output<typeof forumTabsList.output>["items"][number];

// The form for a new category or a new forum under any node. The type is fixed by the form, the
// parent is chosen from the tree, and a category can name the forum list tab it sits in (the
// backend only accepts a tab on a category with no parent).
export async function NodeCreateForm({
  type,
  nodes,
  tabs,
}: {
  type: "category" | "forum";
  nodes: readonly TreeNode[];
  tabs: readonly Tab[];
}) {
  const t = await getTranslations("adminForums.create");
  return (
    <FormRows
      action={createNode}
      id={`new-${type}`}
      heading={type === "category" ? t("headingCategory") : t("headingForum")}
      description={
        type === "category" ? t("descriptionCategory") : t("descriptionForum")
      }
      submit={type === "category" ? t("createCategory") : t("createForum")}
    >
      <input type="hidden" name="type" value={type} />
      <FieldRow name="title" label={t("title")} htmlFor={`${type}-title`}>
        <Input id={`${type}-title`} name="title" required />
      </FieldRow>
      <FieldRow
        name="description"
        label={t("description")}
        htmlFor={`${type}-description`}
      >
        <Textarea id={`${type}-description`} name="description" rows={2} />
      </FieldRow>
      <FieldRow
        name="parentId"
        label={t("parent")}
        htmlFor={`${type}-parent`}
        help={t("parentHelp")}
      >
        <select
          id={`${type}-parent`}
          name="parentId"
          defaultValue=""
          className={selectClass}
        >
          <option value="">{t("noParent")}</option>
          <NodeOptions nodes={nodes} />
        </select>
      </FieldRow>
      <FieldRow
        name="position"
        label={t("position")}
        htmlFor={`${type}-position`}
        help={t("positionHelp")}
      >
        <Input
          id={`${type}-position`}
          name="position"
          type="number"
          inputMode="numeric"
        />
      </FieldRow>
      <FieldRow
        name="iconKey"
        label={t("icon")}
        htmlFor={`${type}-icon`}
        help={t("iconHelp")}
      >
        <IconPicker
          name="iconKey"
          id={`${type}-icon`}
          labelId={`${type}-icon-label`}
        />
      </FieldRow>
      {type === "category" && tabs.length > 0 && (
        <FieldRow
          name="tabId"
          label={t("tab")}
          htmlFor="category-tab"
          help={t("tabHelp")}
        >
          <select
            id="category-tab"
            name="tabId"
            defaultValue=""
            className={selectClass}
          >
            <option value="">{t("noTab")}</option>
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title}
              </option>
            ))}
          </select>
        </FieldRow>
      )}
    </FormRows>
  );
}
