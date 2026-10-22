"use client";

// BroadcastForm: the one form of a message or alert to members. The content, then who gets it (all
// members, the members of some groups, or the members a rule picks), then two steps that go to
// one server action (`runBroadcast`), told apart by the button pressed: send the test to one
// member at once, count who a send would reach (the send is then made of what was counted, from the run
// panel). The form keeps what was typed so a refused step can be corrected.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { FormError } from "@/components/forum/form-error";
import { Field } from "@/components/staff/edit-form";
import { FieldErrors } from "@/components/staff/form-rows";
import { Section } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { runBroadcast } from "./actions";
import {
  ALERT_TEXT_MAX,
  type BroadcastKind,
  type BroadcastState,
  type Step,
  type TestResult,
} from "./state";

type Group = { id: number; title: string };
type Props = {
  kind: BroadcastKind;
  groups: Group[];
  // The rule builder, drawn by the page (it reads the criteria from the backend).
  rule: React.ReactNode;
};

function StepButton({
  step,
  label,
  pendingLabel,
  variant = "default",
}: {
  step: Step;
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

// What the test came to, with the way to see it.
function TestOutcome({ test }: { test: TestResult }) {
  const t = useTranslations("adminCommunication.broadcasts.result");
  if (!test.delivered) {
    return (
      <p role="status" className="text-sm font-medium text-destructive">
        {t("notDelivered", { name: test.name, reason: test.reason ?? "" })}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm font-medium text-success">
      {t("tested", { name: test.name })}{" "}
      <Link
        href={
          test.conversationId === null
            ? "/notifications"
            : `/conversations/${test.conversationId}`
        }
        className="text-primary-ink underline-offset-4 hover:underline"
      >
        {test.conversationId === null ? t("openAlerts") : t("openConversation")}
      </Link>
    </p>
  );
}

export function BroadcastForm(props: Props) {
  const [state, formAction] = useActionState(
    runBroadcast,
    null as BroadcastState,
  );
  return <BroadcastView {...props} state={state} formAction={formAction} />;
}

// The form as its last answer shows it (apart from the hooks, so a test can draw any answer).
export function BroadcastView({
  kind,
  groups,
  rule,
  state,
  formAction,
}: Props & {
  state: BroadcastState;
  formAction: (formData: FormData) => void;
}) {
  const t = useTranslations("adminCommunication.broadcasts.form");
  const [audience, setAudience] = useState<"all" | "groups" | "rule">("all");
  const fields = state?.fields ?? {};
  return (
    <form
      action={formAction}
      className="space-y-4"
      // React empties an uncontrolled form once its action settles; the fields keep what was
      // typed so a refused step can be corrected and the next step sent.
      onResetCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      <FieldErrors value={fields}>
        {kind === "message" ? (
          <Section
            heading={t("messageHeading")}
            description={t("messageDescription")}
          >
            <div className="divide-y">
              <Field
                name="sender"
                label={t("sender")}
                htmlFor="broadcast-sender"
                help={t("senderHelp")}
              >
                <Input
                  id="broadcast-sender"
                  name="sender"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby="broadcast-sender-help"
                />
              </Field>
              <Field name="title" label={t("title")} htmlFor="broadcast-title">
                <Input
                  id="broadcast-title"
                  name="title"
                  required
                  maxLength={150}
                />
              </Field>
              <Field
                name="body"
                label={t("body")}
                htmlFor="broadcast-body"
                help={t("bodyHelp")}
              >
                <Textarea
                  id="broadcast-body"
                  name="body"
                  required
                  rows={10}
                  aria-describedby="broadcast-body-help"
                />
              </Field>
              <Field name="locked" label={t("locked")}>
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input type="checkbox" name="locked" className="size-5" />
                  {t("lockedLabel")}
                </label>
              </Field>
              <Field
                name="removeFromSender"
                label={t("removeFromSender")}
                help={t("removeFromSenderHelp")}
              >
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="removeFromSender"
                    defaultChecked
                    className="size-5"
                  />
                  {t("removeFromSenderLabel")}
                </label>
              </Field>
            </div>
          </Section>
        ) : (
          <Section
            heading={t("alertHeading")}
            description={t("alertDescription")}
          >
            <div className="divide-y">
              <Field
                name="text"
                label={t("text")}
                htmlFor="broadcast-text"
                help={t("textHelp", { max: ALERT_TEXT_MAX })}
              >
                <Textarea
                  id="broadcast-text"
                  name="text"
                  required
                  rows={3}
                  maxLength={ALERT_TEXT_MAX}
                  aria-describedby="broadcast-text-help"
                />
              </Field>
              <Field
                name="url"
                label={t("url")}
                htmlFor="broadcast-url"
                help={t("urlHelp")}
              >
                <Input
                  id="broadcast-url"
                  name="url"
                  maxLength={500}
                  autoComplete="off"
                  aria-describedby="broadcast-url-help"
                />
              </Field>
            </div>
          </Section>
        )}

        <Section heading={t("testHeading")} description={t("testDescription")}>
          <div className="divide-y">
            <Field
              name="recipient"
              label={t("recipient")}
              htmlFor="broadcast-recipient"
              help={t("recipientHelp")}
            >
              <Input
                id="broadcast-recipient"
                name="recipient"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="broadcast-recipient-help"
              />
            </Field>
          </div>
          <div className="space-y-3 border-t p-4">
            {state?.test && <TestOutcome test={state.test} />}
            <StepButton
              step="test"
              variant="outline"
              label={t("test")}
              pendingLabel={t("testing")}
            />
          </div>
        </Section>

        <Section heading={t("audienceHeading")}>
          <div className="divide-y">
            <Field
              name="audience"
              label={t("audience")}
              help={t("audienceHelp")}
            >
              <fieldset className="flex flex-wrap gap-x-5">
                <legend className="sr-only">{t("audience")}</legend>
                {(["all", "groups", "rule"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex min-h-10 items-center gap-2 text-sm font-medium"
                  >
                    <input
                      type="radio"
                      name="audience"
                      value={value}
                      checked={audience === value}
                      onChange={() => setAudience(value)}
                      className="size-5"
                    />
                    {t(
                      value === "all"
                        ? "audienceAll"
                        : value === "groups"
                          ? "audienceGroups"
                          : "audienceRule",
                    )}
                  </label>
                ))}
              </fieldset>
            </Field>
            <div hidden={audience !== "groups"}>
              <Field name="groups" label={t("groups")} help={t("groupsHelp")}>
                <fieldset className="grid gap-x-5 sm:grid-cols-2">
                  <legend className="sr-only">{t("groups")}</legend>
                  {groups.map((group) => (
                    <label
                      key={group.id}
                      className="flex min-h-10 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="groupIds"
                        value={group.id}
                        className="size-5"
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {group.title}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </Field>
            </div>
            <div hidden={audience !== "rule"}>{rule}</div>
          </div>
          <div className="space-y-3 border-t p-4">
            <p className="text-xs text-muted-foreground">{t("countHelp")}</p>
            {state?.error && <FormError>{state.error}</FormError>}
            {state?.notice && (
              <p role="status" className="text-sm font-medium text-success">
                {state.notice}
              </p>
            )}
            <StepButton
              step="count"
              variant="outline"
              label={t("count")}
              pendingLabel={t("counting")}
            />
          </div>
        </Section>
      </FieldErrors>
    </form>
  );
}
