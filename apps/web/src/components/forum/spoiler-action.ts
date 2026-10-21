"use server";

import { spoilersGet } from "@sermo/core/contracts";
import * as z from "zod";
import { withColorGuard } from "@/lib/color-guard";
import { withEmbedGate } from "@/lib/consent/embed-gate";
import { placeInlineAttachments } from "@/lib/inline-attachments";
import { stripHtmlMedia } from "@/lib/lite-content";
import { getLiteLabel, getLiteOrigin, getLiteState } from "@/lib/lite-mode";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { withSpoilerButtons } from "@/lib/spoiler-buttons";

// The files of the item, as its page drew them, which the tags inside the spoiler place. They come
// from the browser, so each address must be one of the backend's file addresses and nothing else.
const FILE_URL = /^\/api\/v1\/files\/\d+(?:\/[^\s"'<>\\?#]*)?$/;
const fileUrl = z.string().regex(FILE_URL);
const size = z.number().int().positive();
const Files = z
  .array(
    z.object({
      fileId: size,
      url: fileUrl,
      thumbnailUrl: fileUrl.nullable(),
      widths: z.array(z.object({ url: fileUrl, width: size })),
      contentType: z.string().max(255),
      byteSize: z.number().int().nonnegative(),
      width: size.nullable(),
      height: size.nullable(),
      filename: z.string().max(1024).nullable(),
    }),
  )
  .max(30);

// The HTML of one spoiler for the visitor who pressed it, filtered like the body it came from
// (LITE mode), with the item's attachments in the place of its `[ATTACH]` tags and with buttons for
// any spoiler inside it. Null when the backend refuses.
export async function revealSpoiler(
  contentType: string,
  contentId: number,
  position: number,
  attachments: unknown = [],
): Promise<{ html: string } | null> {
  const files = Files.safeParse(attachments);
  if (!files.success) return null;
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
    const gated = withColorGuard(
      withSpoilerButtons(
        await withEmbedGate(stripHtmlMedia(html, state, origin, label)),
        true,
      ),
    );
    return { html: await placeInlineAttachments(gated, files.data) };
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
