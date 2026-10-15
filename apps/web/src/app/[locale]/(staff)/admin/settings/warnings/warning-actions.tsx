import {
  groupsList,
  Restriction,
  warningActionsCreate,
  warningActionsList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { ConfirmStep } from "@/components/staff/confirm-step";
import {
  DeleteBox,
  EditDisclosure,
  EntryList,
} from "@/components/staff/entity-list";
import { CheckRow, InputRow } from "@/components/staff/entity-rows";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { call, read } from "@/lib/sermo/client";
import { ifAllowed } from "../../users/data";
import { deleteWarningAction, saveWarningAction } from "./actions";

type WarningAction = z.output<
  typeof warningActionsList.output
>["items"][number];
type Groups = { id: number; title: string }[] | null;

const KINDS = warningActionsCreate.input.shape.kind.options;
const RESTRICTIONS = Restriction.shape.kind.options;

// The form of an automatic action, for a new one (no `action`) or a change. The group and the
// restriction are shown beside each other; the one the chosen kind does not use is ignored. The
// groups are those the viewer may list; without that permission the group's number is typed.
async function ActionForm({
  action,
  groups,
}: {
  action?: WarningAction;
  groups: Groups;
}) {
  const t = await getTranslations("adminSetup.warningActions.form");
  const key = `warning-action-${action?.id ?? "new"}`;
  return (
    <FormRows
      action={saveWarningAction}
      id={action ? undefined : "new"}
      heading={action ? t("headingEdit") : t("headingNew")}
      description={action ? undefined : t("descriptionNew")}
      submit={action ? undefined : t("create")}
    >
      {action && <input type="hidden" name="id" value={action.id} />}
      <InputRow
        name="threshold"
        label={t("threshold")}
        idPrefix={key}
        type="number"
        inputMode="numeric"
        min={1}
        required
        help={t("thresholdHelp")}
        defaultValue={action?.threshold}
      />
      <FieldRow
        name="kind"
        label={t("kind")}
        htmlFor={`${key}-kind`}
        help={t("kindHelp")}
      >
        <select
          id={`${key}-kind`}
          name="kind"
          required
          defaultValue={action?.kind ?? "ban"}
          className={selectClass}
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <InputRow
        name="days"
        label={t("days")}
        idPrefix={key}
        type="number"
        inputMode="numeric"
        min={1}
        max={3650}
        help={t("daysHelp")}
        defaultValue={action?.days ?? undefined}
      />
      <CheckRow
        name="permanent"
        label={t("permanent")}
        text={t("permanentHelp")}
        defaultChecked={action ? action.days === null : false}
      />
      <FieldRow
        name="groupId"
        label={t("group")}
        htmlFor={`${key}-groupId`}
        help={groups ? t("groupHelp") : t("groupTyped")}
      >
        {groups ? (
          <select
            id={`${key}-groupId`}
            name="groupId"
            defaultValue={action?.groupId ?? ""}
            className={selectClass}
          >
            <option value="">{t("chooseGroup")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.title}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={`${key}-groupId`}
            name="groupId"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={action?.groupId ?? undefined}
          />
        )}
      </FieldRow>
      <FieldRow
        name="restrictionKind"
        label={t("restriction")}
        htmlFor={`${key}-restrictionKind`}
        help={t("restrictionHelp")}
      >
        <select
          id={`${key}-restrictionKind`}
          name="restrictionKind"
          defaultValue={action?.restrictionKind ?? ""}
          className={selectClass}
        >
          <option value="">{t("chooseRestriction")}</option>
          {RESTRICTIONS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`restrictions.${kind}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="actorPassword"
        label={t("password")}
        htmlFor={`${key}-actorPassword`}
        help={t("passwordHelp")}
      >
        <PasswordField
          id={`${key}-actorPassword`}
          name="actorPassword"
          autoComplete="off"
        />
      </FieldRow>
    </FormRows>
  );
}

// Every automatic action, lowest threshold first, each with its editor and its delete behind a
// disclosure, then the form for a new one.
export async function WarningActions() {
  const [t, { items }, groups] = await Promise.all([
    getTranslations("adminSetup.warningActions"),
    read(warningActionsList, {}),
    ifAllowed(() => call(groupsList, {})),
  ]);
  const choices: Groups =
    groups?.items.map(({ id, title }) => ({ id, title })) ?? null;
  // What an action does, in a line: "Ban for 7 days", "Add to Probation permanently".
  const describe = (action: WarningAction) => {
    const duration =
      action.days === null
        ? t("permanently")
        : t("forDays", { days: action.days });
    if (action.kind === "group")
      return t("summaryGroup", {
        group: action.groupTitle ?? `#${action.groupId}`,
        duration,
      });
    if (action.kind === "restriction")
      return t("summaryRestriction", {
        restriction: t(
          `form.restrictions.${action.restrictionKind ?? "posting"}`,
        ),
        duration,
      });
    return t("summaryBan", { duration });
  };
  return (
    <>
      <EntryList
        heading={t("heading")}
        description={t("description")}
        none={t("none")}
        items={items.map((action) => (
          <li key={action.id}>
            <EditDisclosure
              summaryClass="min-h-12"
              edit={t("edit")}
              summary={
                <>
                  <Badge variant="secondary">
                    {t("threshold", { count: action.threshold })}
                  </Badge>
                  <span className="text-sm [overflow-wrap:anywhere]">
                    {describe(action)}
                  </span>
                </>
              }
            >
              <ActionForm action={action} groups={choices} />
              <DeleteBox>
                <ConfirmStep
                  action={deleteWarningAction}
                  fields={{ id: action.id }}
                  password={action.kind === "group"}
                  summary={`${t("delete")}…`}
                  warning={t("deleteWarning")}
                  submit={t("delete")}
                />
              </DeleteBox>
            </EditDisclosure>
          </li>
        ))}
      />
      <ActionForm groups={choices} />
    </>
  );
}
