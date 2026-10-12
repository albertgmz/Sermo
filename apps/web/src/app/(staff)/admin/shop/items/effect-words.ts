import type { ShopEffect } from "@sermo/core/contracts";
import type * as z from "zod";
import { permissionTitle } from "../titles";
import type { Lookups } from "./lookups";

type Effect = z.output<typeof ShopEffect>;

// The translator of `adminEconomy.items.effects`, as far as this needs it.
type Say = (
  key: `words.${Effect["type"] | "permissionValue"}`,
  values?: Record<string, string | number>,
) => string;

// An item's effect as a sentence. Names come from the lookups; one that is not in them (a
// catalog entry deleted since, or a list the viewer may not read) shows its id.
export function effectWords(effect: Effect, lookups: Lookups, say: Say) {
  const name = (list: readonly { id: number; name: string }[], id: number) =>
    list.find((entry) => entry.id === id)?.name ?? `#${id}`;
  switch (effect.type) {
    case "frame":
      return say("words.frame", { name: name(lookups.frames, effect.frameId) });
    case "nameColor":
      return say("words.nameColor", {
        name: name(lookups.colours, effect.colorId),
      });
    case "threadCover":
      return say("words.threadCover", {
        name: name(lookups.covers, effect.coverId),
      });
    case "group":
      return say("words.group", {
        name:
          lookups.groups?.find((group) => group.id === effect.groupId)?.title ??
          `#${effect.groupId}`,
      });
    case "permission": {
      const definition = lookups.permissions?.find(
        (entry) => entry.id === effect.permission,
      );
      return say(
        effect.value === undefined
          ? "words.permission"
          : "words.permissionValue",
        {
          name: definition
            ? permissionTitle(definition.label)
            : effect.permission,
          value: effect.value ?? 0,
        },
      );
    }
    case "highlight":
      return say("words.highlight", { days: effect.days });
    case "bump":
      return say("words.bump");
    case "usernameChange":
      return say("words.usernameChange");
  }
}
