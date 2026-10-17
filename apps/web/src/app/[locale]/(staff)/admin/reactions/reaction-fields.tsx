import type { reactionTypesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Advanced, Field, FieldGroup } from "@/components/staff/edit-form";
import { PictureField } from "@/components/staff/picture-field";
import { Input } from "@/components/ui/input";
import { AccessFields, type ForumChoice } from "./access-fields";

type ReactionType = z.output<typeof reactionTypesList.output>["items"][number];

// The help and error lines of a `Field`, by its control's id.
const describedBy = (id: string) => `${id}-help ${id}-error`;

// The fields of the new and the edit page, inside their `EditForm`: the reaction itself, then the
// sprite sheet's frames and who may give it, each in a closed card.
//
// Props
//   type      The type being edited, as the backend holds it (its frames even when LITE hides the
//             picture, since the edit action always sends them); none on the new page, which then
//             also asks for the position and whether it is offered.
//   current   The picture now, drawn through the LITE gate by the page; none when there is none.
//   forums    The forums the type can be limited to.
//   position  The new page's starting position: after the last type.
export async function ReactionFields({
  type,
  current,
  forums,
  position,
}: {
  type?: ReactionType;
  current?: React.ReactNode;
  forums: ForumChoice[];
  position?: number;
}) {
  const t = await getTranslations("adminContent.reactions.form");
  return (
    <>
      <FieldGroup legend={t("basics")} description={t("basicsHelp")}>
        <Field
          name="emoji"
          label={t("emoji")}
          htmlFor="reaction-emoji"
          help={t("emojiHelp")}
        >
          <Input
            id="reaction-emoji"
            name="emoji"
            required
            defaultValue={type?.emoji}
            aria-describedby={describedBy("reaction-emoji")}
            className="w-24"
          />
        </Field>
        <Field name="title" label={t("title")} htmlFor="reaction-title">
          <Input
            id="reaction-title"
            name="title"
            required
            defaultValue={type?.title}
            aria-describedby="reaction-title-error"
          />
        </Field>
        <Field
          name="fileId"
          label={t("picture")}
          htmlFor="reaction-file"
          help={t("pictureHelp")}
        >
          <PictureField
            purpose="reaction_image"
            name="fileId"
            id="reaction-file"
            accept="image/png,image/webp"
            removable={Boolean(type)}
            current={current}
          />
        </Field>
        <Field
          name="score"
          label={t("score")}
          htmlFor="reaction-score"
          help={type ? t("scoreHelp") : t("scoreDefaultHelp")}
        >
          <Input
            id="reaction-score"
            name="score"
            type="number"
            inputMode="numeric"
            required={Boolean(type)}
            defaultValue={type?.score}
            aria-describedby={describedBy("reaction-score")}
            className="w-24"
          />
        </Field>
        {!type && (
          <>
            <Field
              name="position"
              label={t("position")}
              htmlFor="reaction-position"
              help={t("positionHelp")}
            >
              <Input
                id="reaction-position"
                name="position"
                type="number"
                inputMode="numeric"
                defaultValue={position}
                aria-describedby={describedBy("reaction-position")}
                className="w-24"
              />
            </Field>
            <Field name="isActive" label={t("active")}>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className="size-5"
                />
                {t("activeSwitch")}
              </label>
            </Field>
          </>
        )}
      </FieldGroup>
      <Advanced
        label={t("animation")}
        fields={["frameWidth", "frameHeight", "frameCount"]}
      >
        <FrameField
          name="frameWidth"
          label={t("frameWidth")}
          help={t("frameWidthHelp")}
          value={type?.frames?.width}
        />
        <FrameField
          name="frameHeight"
          label={t("frameHeight")}
          help={t("frameHeightHelp")}
          value={type?.frames?.height}
        />
        <FrameField
          name="frameCount"
          label={t("frameCount")}
          help={t("frameCountHelp")}
          value={type?.frames?.count}
        />
      </Advanced>
      <Advanced
        label={t("access")}
        fields={["rule", "forumIds", "hideWhenLocked"]}
      >
        <AccessFields
          idPrefix="reaction"
          owner={type?.id}
          type={type}
          forums={forums}
        />
      </Advanced>
    </>
  );
}

function FrameField({
  name,
  label,
  help,
  value,
}: {
  name: string;
  label: string;
  help: string;
  value?: number;
}) {
  const id = `reaction-${name}`;
  return (
    <Field name={name} label={label} htmlFor={id} help={help}>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={1}
        defaultValue={value}
        aria-describedby={describedBy(id)}
        className="w-24"
      />
    </Field>
  );
}
