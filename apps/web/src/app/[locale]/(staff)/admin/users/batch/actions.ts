"use server";

import {
  BATCH_MEMBER_LIMIT,
  usersBatchPreview,
  usersBatchUpdate,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { invalidArgument } from "@/lib/sermo/outcome";
import {
  formFailure,
  missingPassword,
  ruleOf,
  ruleRefusal,
  text,
  whole,
} from "../../groups/form-errors";
import { ticked } from "../action-helpers";
import {
  BATCH_ACTIONS,
  type BatchState,
  DESTRUCTIVE,
  GROUP_ACTIONS,
  isOneOf,
  NEEDS_PASSWORD,
  PREVIEW_NAMES,
} from "./state";

type Selection = z.input<typeof usersBatchPreview.input>["selection"];
type Action = z.input<typeof usersBatchUpdate.input>["action"];

// The words of a list typed one per line or separated by commas (a username may hold spaces),
// each once.
function wordsOf(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\n,]+/)
    .map((word) => word.trim())
    .filter((word) => {
      const key = word.toLowerCase();
      if (word === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// The selection the form describes, or the state that refuses it. A criteria run resumes after
// `after` (the step "apply@<id>" of the button that continues a run).
async function selectionOf(
  formData: FormData,
  after: number | null,
): Promise<{ selection: Selection } | { refused: BatchState }> {
  const t = await getTranslations("adminUsers.batch.errors");
  const kind = text(formData, "selection");
  if (kind === "list") {
    const members = wordsOf(text(formData, "members"));
    if (members.length === 0) {
      return { refused: { fields: { members: t("noMembers") } } };
    }
    if (members.length > BATCH_MEMBER_LIMIT) {
      return {
        refused: {
          fields: { members: t("tooMany", { count: BATCH_MEMBER_LIMIT }) },
        },
      };
    }
    return { selection: { kind: "list", members } };
  }
  if (kind !== "criteria") {
    return { refused: { error: await invalidArgument() } };
  }
  const rule = ruleOf(formData);
  if (rule === null) return { refused: await ruleRefusal(formData) };
  if (rule.conditions.length === 0) {
    return { refused: { fields: { rule: t("noConditions") } } };
  }
  return {
    selection: {
      kind: "criteria",
      rule,
      ...(after === null ? {} : { after }),
    },
  };
}

// The change the form describes, or the state that refuses it.
async function actionOf(
  formData: FormData,
): Promise<{ action: Action } | { refused: BatchState }> {
  const t = await getTranslations("adminUsers.batch.errors");
  const type = text(formData, "action");
  if (!isOneOf(BATCH_ACTIONS, type)) {
    return { refused: { error: t("noAction") } };
  }
  if (isOneOf(GROUP_ACTIONS, type)) {
    const groupId = parseId(text(formData, "groupId"));
    if (groupId === null) {
      return { refused: { fields: { groupId: t("group") } } };
    }
    return { action: { type, groupId } };
  }
  switch (type) {
    case "setTitle":
      // An empty title takes the custom title off.
      return {
        action: { type, title: text(formData, "title").trim() || null },
      };
    case "ban": {
      const notify = ticked(formData, "notify");
      if (text(formData, "duration") === "forever") {
        return { action: { type, days: null, notify } };
      }
      const days = whole(text(formData, "days"));
      if (days === null || days < 1 || days > 3650) {
        return { refused: { fields: { days: t("days") } } };
      }
      return { action: { type, days, notify } };
    }
    case "liftBans":
      return { action: { type, notify: ticked(formData, "notify") } };
    case "removeAvatar":
    case "removeSignature":
    case "delete":
      return { action: { type } };
    default:
      return { refused: { error: t("noAction") } };
  }
}

// One step of the batch update of members: "preview" asks who a selection names, "apply" applies
// the chosen change to them, "apply@<id>" does so for the members after <id> (the next stretch of
// a criteria run). The backend decides who may be changed and answers for each member.
export async function runBatch(
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const step = /^(preview|apply)(?:@([1-9]\d{0,14}))?$/.exec(
    text(formData, "step"),
  );
  if (!step) return { error: await invalidArgument() };
  const chosen = await selectionOf(formData, step[2] ? Number(step[2]) : null);
  if ("refused" in chosen) return chosen.refused;
  const { selection } = chosen;

  if (step[1] === "preview") {
    try {
      const found = await call(usersBatchPreview, { selection });
      return {
        preview: {
          count: found.items.length,
          names: found.items
            .slice(0, PREVIEW_NAMES)
            .map((item) => item.username),
          unknown: found.unknown,
          next: found.next,
        },
      };
    } catch (error) {
      return formFailure(error, []);
    }
  }

  const t = await getTranslations("adminUsers.batch.errors");
  const picked = await actionOf(formData);
  if ("refused" in picked) return picked.refused;
  const { action } = picked;
  const reason = text(formData, "reason").trim();
  if (isOneOf(DESTRUCTIVE, action.type)) {
    if (reason === "") return { fields: { reason: t("reason") } };
    if (!ticked(formData, "confirm")) return { error: t("confirm") };
  }
  let actorPassword: string | undefined;
  if (isOneOf(NEEDS_PASSWORD, action.type)) {
    const absent = await missingPassword(formData);
    if (absent) return absent;
    actorPassword = text(formData, "actorPassword");
  }
  try {
    const done = await call(usersBatchUpdate, {
      selection,
      action,
      reason,
      ...(actorPassword === undefined ? {} : { actorPassword }),
    });
    return {
      result: {
        items: done.items.map(({ name, status, message }) => ({
          name,
          status,
          message,
        })),
        done: done.done,
        skipped: done.skipped,
        failed: done.failed,
        next: done.next,
      },
    };
  } catch (error) {
    return formFailure(error, ["actorPassword", "reason"]);
  }
}
