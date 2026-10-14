"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { StaffFormState } from "@/components/staff/form-rows";
import { PictureField } from "@/components/staff/picture-field";
import { SubmitButton } from "@/components/staff/submit-button";
import { Input } from "@/components/ui/input";
import { updateReactionType } from "./actions";

// The fields of one reaction type, saved on their own.
export function ReactionRowForm({
  id,
  emoji,
  title,
  score,
  frames,
  current,
}: {
  id: number;
  emoji: string;
  title: string;
  score: number;
  // The cut of the picture now: empty fields mean the whole picture is the one frame.
  frames: { width: number; height: number; count: number } | null;
  // The picture now, drawn through the LITE gate by the page; none when there is no picture.
  current?: React.ReactNode;
}) {
  const t = useTranslations("adminContent.reactions.row");
  const [state, action] = useActionState<StaffFormState, FormData>(
    updateReactionType,
    null,
  );
  const field = `reaction-${id}`;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-[5rem_minmax(0,1fr)_5rem] gap-2">
        <div className="space-y-1">
          <label htmlFor={`${field}-emoji`} className="text-xs font-medium">
            {t("emoji")}
          </label>
          <Input
            id={`${field}-emoji`}
            name="emoji"
            defaultValue={emoji}
            required
            aria-invalid={Boolean(state?.fields?.emoji)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${field}-title`} className="text-xs font-medium">
            {t("title")}
          </label>
          <Input
            id={`${field}-title`}
            name="title"
            defaultValue={title}
            required
            aria-invalid={Boolean(state?.fields?.title)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${field}-score`} className="text-xs font-medium">
            {t("score")}
          </label>
          <Input
            id={`${field}-score`}
            name="score"
            type="number"
            inputMode="numeric"
            defaultValue={score}
            required
            aria-invalid={Boolean(state?.fields?.score)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${field}-file`} className="text-xs font-medium">
          {t("picture")}
        </label>
        <PictureField
          purpose="reaction_image"
          name="fileId"
          id={`${field}-file`}
          removable
          accept="image/png,image/webp"
          current={current}
        />
        <p className="text-xs text-muted-foreground">{t("pictureHelp")}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FrameField
          id={`${field}-frame-width`}
          name="frameWidth"
          label={t("frameWidth")}
          value={frames?.width}
          invalid={Boolean(state?.fields?.frameWidth)}
        />
        <FrameField
          id={`${field}-frame-height`}
          name="frameHeight"
          label={t("frameHeight")}
          value={frames?.height}
          invalid={Boolean(state?.fields?.frameHeight)}
        />
        <FrameField
          id={`${field}-frame-count`}
          name="frameCount"
          label={t("frameCount")}
          value={frames?.count}
          invalid={Boolean(state?.fields?.frameCount)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("framesHelp")}</p>
      <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
        {[state?.error, ...Object.values(state?.fields ?? {})]
          .filter(Boolean)
          .join(" ")}
      </output>
      <SubmitButton
        label={t("save")}
        pendingLabel={t("saving")}
        variant="outline"
      />
    </form>
  );
}

function FrameField({
  id,
  name,
  label,
  value,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  value?: number;
  invalid: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={1}
        defaultValue={value}
        aria-invalid={invalid}
      />
    </div>
  );
}
