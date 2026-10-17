import { nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { Rule } from "@/components/staff/criteria-rule";
import { FieldRow } from "@/components/staff/form-rows";
import { ForumPicker } from "@/components/staff/forum-picker";
import { selectClass } from "@/components/staff/rows";
import { RuleField } from "@/components/staff/rule-field";
import { read } from "@/lib/sermo/client";

// The forums a reaction type can be limited to: every forum, named with its depth.
export type ForumChoice = { id: number; label: string };

// Only forums hold posts, so only forums can be chosen.
export async function forumChoices(): Promise<ForumChoice[]> {
  const { items } = await read(nodesList, {});
  return items
    .filter((node) => node.type === "forum")
    .map((node) => ({
      id: node.id,
      label: `${"— ".repeat(node.depth)}${node.title}`,
    }));
}

// Who may give a reaction type and where: the rule (the shared rule builder, cheap conditions
// only as it is decided on every reaction), the forums it is limited to (empty = everywhere) and
// what a member the rule excludes sees. Used by the new and the edit page, in their Access card.
//
// Props
//   idPrefix  Makes the ids of the controls unique on the page.
//   owner     The id of the type being edited; none for a new one.
//   type      What the type has now; none starts with everyone, everywhere, shown locked.
//   forums    The forums that can be chosen.
export async function AccessFields({
  idPrefix,
  owner,
  type,
  forums,
}: {
  idPrefix: string;
  owner?: number;
  type?: { rule: Rule | null; forumIds: number[]; hideWhenLocked: boolean };
  forums: ForumChoice[];
}) {
  const t = await getTranslations("adminContent.reactions.access");
  return (
    <>
      <RuleField
        place="reactionType"
        owner={owner}
        rule={type?.rule ?? undefined}
      />
      <FieldRow name="forumIds" label={t("forums")} help={t("forumsHelp")}>
        <ForumPicker choices={forums} chosen={type?.forumIds ?? []} />
      </FieldRow>
      <FieldRow
        name="hideWhenLocked"
        label={t("locked")}
        htmlFor={`${idPrefix}-locked`}
        help={t("lockedHelp")}
      >
        <select
          id={`${idPrefix}-locked`}
          name="hideWhenLocked"
          defaultValue={type?.hideWhenLocked ? "1" : "0"}
          aria-describedby={`${idPrefix}-locked-help`}
          className={selectClass}
        >
          <option value="0">{t("lockedShow")}</option>
          <option value="1">{t("lockedHide")}</option>
        </select>
      </FieldRow>
    </>
  );
}
