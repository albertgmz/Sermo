"use client";

// BatchForm: the one form of the batch update of members. Step one chooses the members (a rule of
// the criteria engine, or a list of ids and usernames) and previews who they are; step two picks
// one change and applies it; the answer lists what happened to each member. Both steps go to one
// server action (`runBatch`), told apart by the button that was pressed, and the form keeps what
// was typed so a refused step can be corrected.

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { FormError } from "@/components/forum/form-error";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { FieldErrors, FieldRow } from "@/components/staff/form-rows";
import { MemberOutcomeList } from "@/components/staff/member-outcomes";
import { Section, selectClass } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { runBatch } from "./actions";
import {
  type BatchActionName,
  type BatchState,
  DESTRUCTIVE,
  GROUP_ACTIONS,
  isOneOf,
  NEEDS_PASSWORD,
  type Preview,
  type Result,
} from "./state";

type Group = { id: number; title: string };

// A button that names its step in the form's `step` field; while that step runs it says so.
function StepButton({
  step,
  label,
  pendingLabel,
  variant = "default",
}: {
  step: string;
  label: string;
  pendingLabel: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { pending, data } = useFormStatus();
  const running = pending && data?.get("step") === step;
  return (
    <Button
      type="submit"
      name="step"
      value={step}
      variant={variant}
      disabled={pending}
      className="min-h-10 px-4"
    >
      {running ? pendingLabel : label}
    </Button>
  );
}

function PreviewBlock({ state }: { state: Preview | undefined }) {
  const t = useTranslations("adminUsers.batch.preview");
  if (!state) return null;
  // A stretch of a rule that found nobody is not the end of it: the run goes on from where it
  // stopped.
  if (state.count === 0 && state.next !== null) {
    return (
      <div role="status" className="space-y-2 text-sm">
        <p className="font-medium">{t("noneYet")}</p>
        <StepButton
          step={`preview@${state.next}`}
          variant="outline"
          label={t("further")}
          pendingLabel={t("pending")}
        />
      </div>
    );
  }
  const more = state.count - state.names.length;
  return (
    <div role="status" className="space-y-2 text-sm">
      <p className="font-medium">{t("count", { count: state.count })}</p>
      {state.names.length > 0 && (
        <p className="[overflow-wrap:anywhere]">
          {state.names.join(", ")}
          {more > 0 && ` ${t("more", { count: more })}`}
        </p>
      )}
      {state.unknown.length > 0 && (
        <p className="text-destructive [overflow-wrap:anywhere]">
          {t("unknown", { names: state.unknown.join(", ") })}
        </p>
      )}
      {state.next !== null && (
        <p className="text-muted-foreground">{t("next")}</p>
      )}
    </div>
  );
}

// What the last good answers showed. A refusal carries neither a preview nor a result, and must not
// take the choice of change (and what was typed in it) off the page. A new preview replaces the
// result; a new result raises `round`, which empties the confirmation and the password so that a
// repeat on the next members is confirmed again.
export type Kept = { preview?: Preview; result?: Result; round: number };

export function keepAnswers(kept: Kept, state: BatchState): Kept {
  if (state?.preview && state.preview !== kept.preview) {
    return { preview: state.preview, round: kept.round };
  }
  if (state?.result && state.result !== kept.result) {
    return {
      preview: kept.preview,
      result: state.result,
      round: kept.round + 1,
    };
  }
  return kept;
}

type Props = {
  groups: Group[];
  actions: readonly BatchActionName[];
  limit: number;
  // The rule builder, drawn by the page (it reads the criteria from the backend).
  criteria: React.ReactNode;
};

export function BatchForm(props: Props) {
  const [state, formAction] = useActionState(runBatch, null as BatchState);
  // What the last good answers showed stays while a refused step is corrected.
  const [kept, setKept] = useState<Kept>({ round: 0 });
  const shown = keepAnswers(kept, state);
  if (shown !== kept) setKept(shown);
  return (
    <BatchView
      {...props}
      state={state}
      answers={shown}
      formAction={formAction}
    />
  );
}

// The form as its last answer and the answers kept so far show it (apart from the hooks, so a
// test can draw any of them).
export function BatchView({
  groups,
  actions,
  limit,
  criteria,
  state,
  answers,
  formAction,
}: Props & {
  state: BatchState;
  answers: Kept;
  formAction: (formData: FormData) => void;
}) {
  const t = useTranslations("adminUsers.batch");
  const [kind, setKind] = useState<"criteria" | "list">("criteria");
  const [chosen, setChosen] = useState<BatchActionName | "">("");
  const [forever, setForever] = useState(false);
  const { preview, result, round } = answers;
  const choosing = Boolean(preview && preview.count > 0) || Boolean(result);
  const fields = state?.fields ?? {};
  return (
    <form
      action={formAction}
      className="space-y-4"
      // React empties an uncontrolled form once its action settles; the fields keep what was
      // typed so a refused step can be corrected and a change repeated on the next members.
      onResetCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <FieldErrors value={fields}>
        <Section
          heading={t("who.heading")}
          description={t("who.description", { count: limit })}
        >
          <div className="divide-y">
            <FieldRow name="selection" label={t("who.kind")}>
              <fieldset className="flex flex-wrap gap-x-5">
                <legend className="sr-only">{t("who.kind")}</legend>
                {(["criteria", "list"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex min-h-10 items-center gap-2 text-sm font-medium"
                  >
                    <input
                      type="radio"
                      name="selection"
                      value={value}
                      checked={kind === value}
                      onChange={() => setKind(value)}
                      className="size-5"
                    />
                    {t(`who.${value}`)}
                  </label>
                ))}
              </fieldset>
            </FieldRow>
            <div hidden={kind !== "criteria"}>{criteria}</div>
            <div hidden={kind !== "list"}>
              <FieldRow
                name="members"
                label={t("who.members")}
                htmlFor="batch-members"
                help={t("who.membersHelp", { count: limit })}
              >
                <Textarea
                  id="batch-members"
                  name="members"
                  rows={6}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </FieldRow>
            </div>
          </div>
          <div className="space-y-3 border-t p-4">
            {state?.error && !choosing && <FormError>{state.error}</FormError>}
            <PreviewBlock state={preview} />
            <StepButton
              step="preview"
              variant="outline"
              label={t("preview.submit")}
              pendingLabel={t("preview.pending")}
            />
          </div>
        </Section>

        {choosing && (
          <Section
            heading={t("what.heading")}
            description={t("what.description")}
          >
            <div className="divide-y">
              <FieldRow
                name="action"
                label={t("what.action")}
                htmlFor="batch-action"
              >
                <select
                  id="batch-action"
                  name="action"
                  value={chosen}
                  onChange={(event) =>
                    setChosen(event.target.value as BatchActionName | "")
                  }
                  required
                  className={selectClass}
                >
                  <option value="">{t("what.choose")}</option>
                  {actions.map((name) => (
                    <option key={name} value={name}>
                      {t(`actions.${name}`)}
                    </option>
                  ))}
                </select>
              </FieldRow>
              {isOneOf(GROUP_ACTIONS, chosen) && (
                <FieldRow
                  name="groupId"
                  label={t("what.group")}
                  htmlFor="batch-group"
                  help={t(`what.groupHelp.${chosen}`)}
                >
                  <select
                    id="batch-group"
                    name="groupId"
                    defaultValue=""
                    required
                    className={selectClass}
                  >
                    <option value="" disabled>
                      {t("what.chooseGroup")}
                    </option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.title}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              )}
              {chosen === "setTitle" && (
                <FieldRow
                  name="title"
                  label={t("what.title")}
                  htmlFor="batch-title"
                  help={t("what.titleHelp")}
                >
                  <Input
                    id="batch-title"
                    name="title"
                    autoComplete="off"
                    maxLength={100}
                  />
                </FieldRow>
              )}
              {chosen === "ban" && (
                <FieldRow
                  name="days"
                  label={t("what.duration")}
                  htmlFor="batch-days"
                  help={t("what.durationHelp")}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="duration"
                        value="days"
                        checked={!forever}
                        onChange={() => setForever(false)}
                        className="size-5"
                      />
                      <Input
                        id="batch-days"
                        name="days"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={3650}
                        defaultValue={7}
                        disabled={forever}
                        aria-label={t("what.days")}
                        className="w-24"
                      />
                      {t("what.daysUnit")}
                    </label>
                    <label className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="duration"
                        value="forever"
                        checked={forever}
                        onChange={() => setForever(true)}
                        className="size-5"
                      />
                      {t("what.forever")}
                    </label>
                  </div>
                </FieldRow>
              )}
              {(chosen === "ban" || chosen === "liftBans") && (
                <FieldRow name="notify" label={t("what.notify")}>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="notify"
                      defaultChecked
                      className="size-5"
                    />
                    {t("what.notifyLabel")}
                  </label>
                </FieldRow>
              )}
              {chosen !== "" && (
                <FieldRow
                  name="reason"
                  label={t("what.reason")}
                  htmlFor="batch-reason"
                  help={t(
                    isOneOf(DESTRUCTIVE, chosen)
                      ? "what.reasonRequired"
                      : "what.reasonHelp",
                  )}
                >
                  <Textarea
                    id="batch-reason"
                    name="reason"
                    rows={2}
                    required={isOneOf(DESTRUCTIVE, chosen)}
                    maxLength={1000}
                  />
                </FieldRow>
              )}
              {isOneOf(NEEDS_PASSWORD, chosen) && (
                <ConfirmPassword key={round} id="batch-password" />
              )}
              {isOneOf(DESTRUCTIVE, chosen) && (
                <FieldRow key={round} name="confirm" label={t("what.confirm")}>
                  <label className="flex min-h-10 items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="confirm"
                      required
                      className="mt-0.5 size-5 shrink-0"
                    />
                    <span className="min-w-0 font-medium text-pretty text-destructive">
                      {t(`what.confirmText.${chosen}`)}
                    </span>
                  </label>
                </FieldRow>
              )}
            </div>
            <div className="space-y-3 border-t p-4">
              {state?.error && <FormError>{state.error}</FormError>}
              <StepButton
                step="apply"
                label={t("what.apply")}
                pendingLabel={t("what.applying")}
                variant={
                  chosen !== "" && isOneOf(DESTRUCTIVE, chosen)
                    ? "destructive"
                    : "default"
                }
              />
            </div>
          </Section>
        )}
      </FieldErrors>

      {result && (
        <Section heading={t("result.heading")}>
          <div className="space-y-3 p-4">
            <p role="status" className="text-sm font-medium text-success">
              {t("result.counts", {
                done: result.done,
                skipped: result.skipped,
                failed: result.failed,
              })}
            </p>
            {result.items.length > 0 && (
              <MemberOutcomeList items={result.items} />
            )}
            {result.next !== null && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("result.more")}
                </p>
                {isOneOf(NEEDS_PASSWORD, chosen) ||
                isOneOf(DESTRUCTIVE, chosen) ? (
                  <p className="text-sm text-muted-foreground">
                    {t("result.confirmAgain")}
                  </p>
                ) : null}
                <StepButton
                  step={`apply@${result.next}`}
                  variant="outline"
                  label={t("result.continue")}
                  pendingLabel={t("what.applying")}
                />
              </div>
            )}
          </div>
        </Section>
      )}
    </form>
  );
}
