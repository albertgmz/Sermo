import { REGISTRATION_FIELDS, usersCards } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { MemberField } from "@/components/forum/member-field";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { read } from "@/lib/sermo/client";
import { saveMembers } from "../actions";
import { getSettings } from "../data";
import { ChecklistRow, NumberRow, SwitchRow } from "../fields";
import { Shown } from "../shown";

// The username of the member who sends the welcome message, if one is named and still exists.
async function senderName(userId: number | null): Promise<string | undefined> {
  if (userId === null) return undefined;
  const { items } = await read(usersCards, { userIds: [userId] });
  return items[0]?.username;
}

export async function MembersForm() {
  const [t, w, fieldNames, settings] = await Promise.all([
    getTranslations("adminSetup.pages.members"),
    getTranslations("adminSetup.pages.members.welcome"),
    getTranslations("adminSetup.registrationFields"),
    getSettings(),
  ]);
  const welcome = settings.welcomeMessage;
  const sender = await senderName(welcome.senderId);
  return (
    <EditForm action={saveMembers}>
      <FieldGroup
        legend={t("registration")}
        description={t("registrationNote")}
      >
        <SwitchRow name="registrationOpen" value={settings.registrationOpen} />
        <SwitchRow name="approveSignups" value={settings.approveSignups} />
        <SwitchRow
          name="requireEmailConfirmation"
          value={settings.requireEmailConfirmation}
        />
        <NumberRow name="minimumAge" value={settings.minimumAge} />
        <ChecklistRow
          name="registrationFields"
          options={REGISTRATION_FIELDS.map((kind) => ({
            kind,
            label: fieldNames(kind),
          }))}
          value={settings.registrationFields}
        />
      </FieldGroup>
      <FieldGroup legend={w("heading")} description={w("note")}>
        {/* The four rows are one setting, replaced whole by a form that shows it. */}
        <Shown name="welcomeMessage" />
        <Field
          name="welcomeMessage.enabled"
          label={w("enabledLabel")}
          help={w("enabledHelp")}
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="welcomeMessage.enabled"
              defaultChecked={welcome.enabled}
              className="size-5"
            />
            {w("enabledSwitch")}
          </label>
        </Field>
        <Field
          name="welcomeMessage.sender"
          label={w("senderLabel")}
          help={w("senderHelp")}
        >
          {/* The row's own label stands for the picker's. */}
          <div className="[&_label]:sr-only">
            <MemberField
              name="welcomeMessage.sender"
              label={w("senderLabel")}
              initial={sender}
            />
          </div>
        </Field>
        <Field
          name="welcomeMessage.subject"
          label={w("subjectLabel")}
          htmlFor="field-welcomeSubject"
          help={w("subjectHelp")}
        >
          <Input
            id="field-welcomeSubject"
            name="welcomeMessage.subject"
            maxLength={150}
            defaultValue={welcome.subject}
            aria-describedby="field-welcomeSubject-help"
          />
        </Field>
        <Field
          name="welcomeMessage.body"
          label={w("bodyLabel")}
          htmlFor="field-welcomeBody"
          help={w("bodyHelp")}
        >
          <Textarea
            id="field-welcomeBody"
            name="welcomeMessage.body"
            rows={8}
            maxLength={5000}
            defaultValue={welcome.body}
            aria-describedby="field-welcomeBody-help"
          />
        </Field>
      </FieldGroup>
      <FieldGroup legend={t("formHeading")}>
        <NumberRow name="newMemberDays" value={settings.newMemberDays} />
        <NumberRow
          name="firstPostsToModerate"
          value={settings.firstPostsToModerate}
        />
        <SwitchRow
          name="moderateLinksFromNewMembers"
          value={settings.moderateLinksFromNewMembers}
        />
        <NumberRow
          name="newMemberMentionLimit"
          value={settings.newMemberMentionLimit}
        />
      </FieldGroup>
    </EditForm>
  );
}
