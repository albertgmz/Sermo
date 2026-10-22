"use server";

import {
  broadcastsCount,
  broadcastsDiscard,
  broadcastsResume,
  broadcastsSend,
  broadcastsStop,
  broadcastsTest,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import type { Rule } from "@/components/staff/criteria-rule";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { invalidArgument } from "@/lib/sermo/outcome";
import {
  formFailure,
  missingPassword,
  ruleOf,
  ruleRefusal,
  text,
} from "../groups/form-errors";
import { ticked } from "../users/action-helpers";
import { type BroadcastState, isStep } from "./state";

type Content = z.input<typeof broadcastsCount.input>["content"];

// The pages show the latest run, so every write renews both.
function renew() {
  revalidatePath("/[locale]/admin/broadcasts/message", "page");
  revalidatePath("/[locale]/admin/broadcasts/alert", "page");
}

// The id of the member a username names (case aside), or null: the search is by prefix.
async function memberNamed(name: string): Promise<number | null> {
  const found = await findRecipients(name);
  const key = name.toLowerCase();
  return found.find((item) => item.username.toLowerCase() === key)?.id ?? null;
}

// The content the form describes, or the state that refuses it.
async function contentOf(
  formData: FormData,
): Promise<{ content: Content } | { refused: BroadcastState }> {
  if (text(formData, "kind") === "alert") {
    const url = text(formData, "url").trim();
    return {
      content: {
        kind: "alert",
        text: text(formData, "text"),
        url: url === "" ? null : url,
      },
    };
  }
  const sender = text(formData, "sender").trim();
  let senderId: number | undefined;
  if (sender !== "") {
    const id = await memberNamed(sender);
    if (id === null) {
      const t = await getTranslations("adminCommunication.broadcasts.errors");
      return { refused: { fields: { sender: t("sender") } } };
    }
    senderId = id;
  }
  return {
    content: {
      kind: "message",
      ...(senderId === undefined ? {} : { senderId }),
      title: text(formData, "title"),
      body: text(formData, "body"),
      locked: ticked(formData, "locked"),
      removeFromSender: ticked(formData, "removeFromSender"),
    },
  };
}

// The audience the form describes as a rule of the criteria engine, or the state that refuses it:
// everyone, the members of the groups ticked, or the rule the builder sent.
async function audienceOf(
  formData: FormData,
): Promise<{ rule: Rule } | { refused: BroadcastState }> {
  const audience = text(formData, "audience");
  if (audience === "rule") {
    const rule = ruleOf(formData);
    if (rule === null) return { refused: await ruleRefusal(formData) };
    // A rule with no condition would reach everyone: that is the other choice, not this one.
    if (rule.conditions.length === 0) {
      const t = await getTranslations("adminCommunication.broadcasts.errors");
      return { refused: { fields: { rule: t("emptyRule") } } };
    }
    return { rule };
  }
  if (audience === "groups") {
    const ids = formData
      .getAll("groupIds")
      .map((value) => parseId(String(value)))
      .filter((id) => id !== null);
    if (ids.length === 0) {
      const t = await getTranslations("adminCommunication.broadcasts.errors");
      return { refused: { fields: { groups: t("noGroups") } } };
    }
    return {
      rule: {
        match: "all",
        conditions: [{ criterion: "in_group", ids: [...new Set(ids)] }],
      },
    };
  }
  return { rule: { match: "all", conditions: [] } };
}

const KNOWN = ["title", "body", "text", "url", "sender"];

// One step of the form of a message or alert to members, told apart by the button that was
// pressed: "test" sends it to one member at once, and "count" counts who a send would reach (the
// send is then made of what was counted, from the run panel).
export async function runBroadcast(
  _previous: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const step = text(formData, "step");
  if (!isStep(step)) return { error: await invalidArgument() };
  const t = await getTranslations("adminCommunication.broadcasts");
  const made = await contentOf(formData);
  if ("refused" in made) return made.refused;
  const { content } = made;
  try {
    if (step === "test") {
      const typed = text(formData, "recipient").trim();
      const recipientId = typed === "" ? undefined : await memberNamed(typed);
      if (recipientId === null)
        return { fields: { recipient: t("errors.noMember") } };
      const sent = await call(broadcastsTest, {
        content,
        ...(recipientId === undefined ? {} : { recipientId }),
      });
      return {
        test: {
          name: sent.recipient.username,
          delivered: sent.delivered,
          reason: sent.reason,
          conversationId: sent.conversationId,
        },
      };
    }
    const chosen = await audienceOf(formData);
    if ("refused" in chosen) return chosen.refused;
    const { queued } = await call(broadcastsCount, {
      content,
      rule: chosen.rule,
    });
    renew();
    return queued
      ? { notice: t("result.countQueued") }
      : { error: t("result.notQueued") };
  } catch (error) {
    return formFailure(error, KNOWN);
  }
}

// Send what the latest count counted; asks for the password.
export async function sendCounted(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.broadcasts.run");
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    const { queued } = await call(broadcastsSend, {
      actorPassword: text(formData, "actorPassword"),
    });
    renew();
    return queued ? { notice: t("sendQueued") } : { error: t("notQueued") };
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
}

// Resume the send that stopped (it keeps its content and audience); asks for the password.
export async function resumeSend(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.broadcasts.run");
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    const { queued } = await call(broadcastsResume, {
      actorPassword: text(formData, "actorPassword"),
    });
    renew();
    return queued ? { notice: t("queued") } : { error: t("notQueued") };
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
}

// Resume the count that stopped; it changes nothing that stays, so it asks for no password.
export async function resumeCount(
  _previous: StaffFormState,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.broadcasts.run");
  try {
    const { queued } = await call(broadcastsResume, {});
    renew();
    return queued ? { notice: t("countResumed") } : { error: t("notQueued") };
  } catch (error) {
    return formFailure(error, []);
  }
}

// Give up the send that stopped (what it sent stays sent); asks for the password.
export async function discardSend(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.broadcasts.run");
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    const { discarded } = await call(broadcastsDiscard, {
      actorPassword: text(formData, "actorPassword"),
    });
    renew();
    return discarded
      ? { notice: t("discarded") }
      : { error: t("nothingToDiscard") };
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
}

// Give up the count that stopped.
export async function discardCount(
  _previous: StaffFormState,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.broadcasts.run");
  try {
    const { discarded } = await call(broadcastsDiscard, {});
    renew();
    return discarded
      ? { notice: t("discarded") }
      : { error: t("nothingToDiscard") };
  } catch (error) {
    return formFailure(error, []);
  }
}

// End the run under way before its next chunk.
export async function stopRun(
  _previous: StaffFormState,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.broadcasts.run");
  try {
    const { stopped } = await call(broadcastsStop, {});
    renew();
    return stopped
      ? { notice: t("stopRequested") }
      : { error: t("nothingToStop") };
  } catch (error) {
    return formFailure(error, []);
  }
}
