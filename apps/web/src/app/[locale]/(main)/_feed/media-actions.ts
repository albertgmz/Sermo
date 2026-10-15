"use server";

import type { PictureResult } from "@/components/forum/picture-types";
import { isRecordId } from "@/lib/sermo/ids";
import { pictureDetails } from "@/lib/sermo/media-pictures";

// What the picture viewer shows beside a picture, asked for when it opens one: who posted it and
// where, the reactions, and whether the viewer may answer. The arguments come from an address the
// visitor can edit, so anything that is not a picture reference is `gone`.
export async function loadPicture(
  kind: string,
  contentId: number,
  fileId: number,
): Promise<PictureResult> {
  if (kind !== "post" && kind !== "wall") return { status: "gone" };
  if (!isRecordId(contentId) || !isRecordId(fileId)) return { status: "gone" };
  return pictureDetails(kind, contentId, fileId);
}
