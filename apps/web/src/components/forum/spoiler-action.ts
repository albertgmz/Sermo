"use server";

import { spoilersGet } from "@sermo/core/contracts";
import { withEmbedGate } from "@/lib/consent/embed-gate";
import { stripHtmlMedia } from "@/lib/lite-markdown";
import { getLiteLabel, getLiteOrigin, getLiteState } from "@/lib/lite-mode";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { withSpoilerButtons } from "@/lib/spoiler-buttons";

// The HTML of one spoiler for the visitor who pressed it, filtered like the body it came from
// (LITE mode) and with buttons for any spoiler inside it. Null when the backend refuses.
export async function revealSpoiler(
  contentType: string,
  contentId: number,
  position: number,
): Promise<{ html: string } | null> {
  const input = spoilersGet.input.safeParse({
    contentType,
    contentId,
    position,
  });
  if (!input.success) return null;
  try {
    const [{ html }, state, origin, label] = await Promise.all([
      call(spoilersGet, input.data),
      getLiteState(),
      getLiteOrigin(),
      getLiteLabel(),
    ]);
    return {
      html: withSpoilerButtons(
        await withEmbedGate(stripHtmlMedia(html, state, origin, label)),
        true,
      ),
    };
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
