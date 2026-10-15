"use server";

import {
  awardsCreate,
  awardsCriteria,
  awardsDelete,
  awardsRun,
  awardsUpdate,
  imagesSetAwardImage,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, ruleOf, text, whole } from "../groups/form-errors";

const FIELDS = [
  "name",
  "description",
  "icon",
  "tier",
  "xp",
  "credits",
  "isStackable",
  "isActive",
  "rule",
];

const TIERS: readonly string[] = awardsCreate.input.shape.tier.options;

// A new award (no id) or a change of one. A new picture is the file uploaded first; it is
// attached after the award is saved, which is the only moment an award has an id.
export async function saveAward(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.awards.errors");
  const raw = text(formData, "id");
  const awardId = raw === "" ? null : parseId(raw);
  if (raw !== "" && awardId === null) return { error: t("id") };
  const tier = text(formData, "tier");
  if (!TIERS.includes(tier)) return { fields: { tier: t("tier") } };
  const xp = whole(text(formData, "xp").trim());
  if (xp === null) return { fields: { xp: t("number") } };
  const credits = whole(text(formData, "credits").trim());
  if (credits === null) return { fields: { credits: t("number") } };
  const typedFile = text(formData, "fileId");
  const fileId = typedFile === "" ? undefined : parseId(typedFile);
  if (fileId === null) return { error: t("file") };
  const removePicture = text(formData, "fileIdRemove") === "1";

  let rule: ReturnType<typeof ruleOf>;
  try {
    rule = ruleOf((await call(awardsCriteria, {})).items, formData);
  } catch (error) {
    return formFailure(error, []);
  }
  if (rule === null) return { fields: { rule: t("criterionValue") } };

  const fields = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    icon: text(formData, "icon"),
    tier: tier as (typeof awardsCreate.input.shape.tier.options)[number],
    xp,
    credits,
    isStackable: formData.get("isStackable") !== null,
    isActive: formData.get("isActive") !== null,
    rule,
  };
  let saved: number;
  try {
    saved = (
      awardId === null
        ? await call(awardsCreate, fields)
        : await call(awardsUpdate, { awardId, ...fields })
    ).id;
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  let pictureRefused = false;
  if (fileId != null || (removePicture && awardId !== null)) {
    try {
      await call(imagesSetAwardImage, {
        awardId: saved,
        fileId: fileId ?? null,
      });
    } catch (error) {
      // The award is saved; a second submit of this form would create it again.
      if (awardId === null) pictureRefused = true;
      else return formFailure(error, ["fileId"]);
    }
  }
  if (awardId === null) {
    redirect(
      pictureRefused
        ? `/admin/awards/${saved}?notice=createdNoPicture`
        : "/admin/awards?notice=created",
    );
  }
  redirect(`/admin/awards/${saved}?notice=saved`);
}

// Delete an award; the backend refuses one that was ever granted, which can only be deactivated.
export async function deleteAward(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.awards.errors");
  const awardId = parseId(text(formData, "id"));
  if (awardId === null) return { error: t("id") };
  try {
    await call(awardsDelete, { awardId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect("/admin/awards?notice=deleted");
}

// Queue the sweep of every member against every active automatic award.
export async function runAwards(
  _previous: StaffFormState,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.awards");
  try {
    const { queued } = await call(awardsRun, {});
    return queued ? { notice: t("runQueued") } : { error: t("runNotQueued") };
  } catch (error) {
    return formFailure(error, []);
  }
}
