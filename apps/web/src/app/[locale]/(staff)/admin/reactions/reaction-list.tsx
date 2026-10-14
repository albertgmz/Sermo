import { reactionTypesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { PictureField } from "@/components/staff/picture-field";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { asType, withoutBlockedPictures } from "@/lib/sermo/reactions";
import {
  createReactionType,
  saveReactionOrder,
  setReactionTypeActive,
} from "./actions";

import { ReactionRowForm } from "./row-form";

// Every reaction type in the backend's display order, then the order form and the form for a new
// type.
export async function ReactionList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminContent.reactions"),
    read(reactionTypesList, {}),
  ]);
  // What a visitor would see: a picture LITE blocks is the emoji here too.
  const shown = (await withoutBlockedPictures(items)).map(asType);
  const lastPosition = items.reduce(
    (most, item) => Math.max(most, item.position),
    0,
  );
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          ordered: t("notices.ordered"),
          activated: t("notices.activated"),
          deactivated: t("notices.deactivated"),
        }}
      />
      <Section heading={t("list.heading")} description={t("list.description")}>
        <ul aria-label={t("list.heading")} className="divide-y">
          {items.map((item, index) => (
            <li key={item.id} className="space-y-2 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <ReactionPicture
                  emoji={item.emoji}
                  picture={shown[index].picture}
                  className="text-xl"
                />
                <span className="[overflow-wrap:anywhere]">{item.title}</span>
                <Badge variant={item.isActive ? "success" : "secondary"}>
                  {item.isActive ? t("list.active") : t("list.inactive")}
                </Badge>
              </p>
              <ReactionRowForm
                id={item.id}
                emoji={item.emoji}
                title={item.title}
                score={item.score}
                frames={item.frames && { ...item.frames }}
                current={
                  item.image ? (
                    <ReactionPicture
                      emoji={item.emoji}
                      picture={shown[index].picture}
                      label={item.title}
                    />
                  ) : undefined
                }
              />
              <ConfirmStep
                action={setReactionTypeActive}
                fields={{
                  id: String(item.id),
                  active: item.isActive ? "0" : "1",
                }}
                summary={
                  item.isActive ? t("list.deactivate") : t("list.activate")
                }
                warning={
                  item.isActive
                    ? t("list.deactivateWarning")
                    : t("list.activateWarning")
                }
                submit={
                  item.isActive ? t("list.deactivate") : t("list.activate")
                }
                danger={item.isActive}
              />
            </li>
          ))}
        </ul>
      </Section>
      {items.length > 1 && (
        <FormRows
          action={saveReactionOrder}
          heading={t("order.heading")}
          description={t("order.description")}
          submit={t("order.submit")}
        >
          {items.map((item) => {
            const id = `position-${item.id}`;
            return (
              <FieldRow
                key={item.id}
                name={`position.${item.id}`}
                label={`${item.emoji} ${item.title}`}
                htmlFor={id}
              >
                <Input
                  id={id}
                  name={`position.${item.id}`}
                  type="number"
                  inputMode="numeric"
                  required
                  defaultValue={item.position}
                />
              </FieldRow>
            );
          })}
        </FormRows>
      )}
      <FormRows
        action={createReactionType}
        heading={t("create.heading")}
        description={t("create.description")}
        submit={t("create.submit")}
        id="new"
      >
        <FieldRow
          name="emoji"
          label={t("create.emoji")}
          htmlFor="new-emoji"
          help={t("create.emojiHelp")}
        >
          <Input id="new-emoji" name="emoji" required />
        </FieldRow>
        <FieldRow name="title" label={t("create.title")} htmlFor="new-title">
          <Input id="new-title" name="title" required />
        </FieldRow>
        <FieldRow
          name="fileId"
          label={t("create.picture")}
          htmlFor="new-file"
          help={t("create.pictureHelp")}
        >
          <PictureField
            purpose="reaction_image"
            name="fileId"
            id="new-file"
            accept="image/png,image/webp"
          />
        </FieldRow>
        <FieldRow
          name="frameWidth"
          label={t("create.frameWidth")}
          htmlFor="new-frame-width"
          help={t("create.framesHelp")}
        >
          <Input
            id="new-frame-width"
            name="frameWidth"
            type="number"
            inputMode="numeric"
            min={1}
          />
        </FieldRow>
        <FieldRow
          name="frameHeight"
          label={t("create.frameHeight")}
          htmlFor="new-frame-height"
        >
          <Input
            id="new-frame-height"
            name="frameHeight"
            type="number"
            inputMode="numeric"
            min={1}
          />
        </FieldRow>
        <FieldRow
          name="frameCount"
          label={t("create.frameCount")}
          htmlFor="new-frame-count"
          help={t("create.frameCountHelp")}
        >
          <Input
            id="new-frame-count"
            name="frameCount"
            type="number"
            inputMode="numeric"
            min={1}
          />
        </FieldRow>
        <FieldRow
          name="score"
          label={t("create.score")}
          htmlFor="new-score"
          help={t("create.scoreHelp")}
        >
          <Input
            id="new-score"
            name="score"
            type="number"
            inputMode="numeric"
          />
        </FieldRow>
        <FieldRow
          name="position"
          label={t("create.position")}
          htmlFor="new-position"
          help={t("create.positionHelp")}
        >
          <Input
            id="new-position"
            name="position"
            type="number"
            inputMode="numeric"
            defaultValue={lastPosition + 1}
          />
        </FieldRow>
        <FieldRow
          name="isActive"
          label={t("create.active")}
          htmlFor="new-active"
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="new-active"
              type="checkbox"
              name="isActive"
              defaultChecked
              className="size-5"
            />
            {t("create.activeSwitch")}
          </label>
        </FieldRow>
      </FormRows>
    </>
  );
}
