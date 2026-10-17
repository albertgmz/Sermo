import type { forumTabsList, nodesGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { IconPicker } from "@/components/icons/icon-picker";
import {
  Advanced,
  EditForm,
  Field,
  FieldGroup,
} from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveNode } from "../actions";
import { NodeOptions, type TreeNode } from "../node-options";

type Node = z.output<typeof nodesGet.output>["node"];
type Tab = z.output<typeof forumTabsList.output>["items"][number];

function Switch({
  name,
  id,
  label,
  checked,
}: {
  name: string;
  id: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="size-5"
      />
      {label}
    </label>
  );
}

// Every field `nodes.update` takes, grouped. The type of a node is fixed when it is created and is
// shown, not edited. The tab of the forum list belongs to a root node only, so the row is there
// only for one (`hasTab` tells the action the field was shown). Read only and the approval
// switches, which most forums never touch, sit in the closed advanced card.
export async function NodeForm({
  node,
  nodes,
  tabs,
}: {
  node: Node;
  nodes: readonly TreeNode[];
  tabs: readonly Tab[];
}) {
  const t = await getTranslations("adminForums.edit");
  const { settings } = node;
  return (
    <EditForm action={saveNode}>
      <input type="hidden" name="id" value={node.id} />
      <FieldGroup legend={t("groupIdentity")}>
        <Field name="title" label={t("title")} htmlFor="node-title">
          <Input
            id="node-title"
            name="title"
            required
            defaultValue={node.title}
          />
        </Field>
        <Field
          name="description"
          label={t("descriptionLabel")}
          htmlFor="node-description"
        >
          <Textarea
            id="node-description"
            name="description"
            rows={3}
            defaultValue={node.description}
          />
        </Field>
        <Field
          name="parentId"
          label={t("parent")}
          htmlFor="node-parent"
          help={t("parentHelp")}
        >
          <select
            id="node-parent"
            name="parentId"
            defaultValue={node.parentId ?? ""}
            className={selectClass}
          >
            <option value="">{t("noParent")}</option>
            <NodeOptions nodes={nodes} without={node.id} />
          </select>
        </Field>
        <Field
          name="position"
          label={t("position")}
          htmlFor="node-position"
          help={t("positionHelp")}
        >
          <Input
            id="node-position"
            name="position"
            type="number"
            inputMode="numeric"
            required
            defaultValue={node.position}
          />
        </Field>
        <Field
          name="iconKey"
          label={t("icon")}
          htmlFor="node-icon-key"
          help={t("iconHelp")}
        >
          <IconPicker
            name="iconKey"
            id="node-icon-key"
            labelId="node-icon-key-label"
            defaultValue={node.iconKey}
          />
        </Field>
        {node.parentId === null && (
          <Field
            name="tabId"
            label={t("tab")}
            htmlFor="node-tab"
            help={t("tabHelp")}
          >
            <input type="hidden" name="hasTab" value="1" />
            <select
              id="node-tab"
              name="tabId"
              defaultValue={node.tabId ?? ""}
              className={selectClass}
            >
              <option value="">{t("noTab")}</option>
              {tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.title}
                </option>
              ))}
            </select>
          </Field>
        )}
      </FieldGroup>
      <FieldGroup legend={t("groupPosting")}>
        <Field
          name="minAccountAgeDays"
          label={t("minAccountAgeDays")}
          htmlFor="node-min-age"
          help={t("minAccountAgeDaysHelp")}
        >
          <Input
            id="node-min-age"
            name="minAccountAgeDays"
            type="number"
            inputMode="numeric"
            required
            defaultValue={settings.minAccountAgeDays}
          />
        </Field>
        <Field
          name="minPostCount"
          label={t("minPostCount")}
          htmlFor="node-min-posts"
          help={t("minPostCountHelp")}
        >
          <Input
            id="node-min-posts"
            name="minPostCount"
            type="number"
            inputMode="numeric"
            required
            defaultValue={settings.minPostCount}
          />
        </Field>
      </FieldGroup>
      <Advanced
        label={t("groupApproval")}
        fields={["isReadOnly", "requireThreadApproval", "requireReplyApproval"]}
      >
        <Field name="isReadOnly" label={t("readOnly")}>
          <Switch
            id="node-read-only"
            name="isReadOnly"
            label={t("readOnlyHelp")}
            checked={settings.isReadOnly}
          />
        </Field>
        <Field name="requireThreadApproval" label={t("threadApproval")}>
          <Switch
            id="node-thread-approval"
            name="requireThreadApproval"
            label={t("threadApprovalHelp")}
            checked={settings.requireThreadApproval}
          />
        </Field>
        <Field name="requireReplyApproval" label={t("replyApproval")}>
          <Switch
            id="node-reply-approval"
            name="requireReplyApproval"
            label={t("replyApprovalHelp")}
            checked={settings.requireReplyApproval}
          />
        </Field>
      </Advanced>
    </EditForm>
  );
}
