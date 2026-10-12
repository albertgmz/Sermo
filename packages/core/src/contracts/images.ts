import * as z from "zod";
import { defineContract } from "../operation";
import { Id } from "./common";

const ImageSet = z.object({ fileId: Id, url: z.string() });
export const ImageReference = ImageSet.nullable();
/** In every operation below, `fileId: null` removes the picture (and deletes its file). */
const FileInput = z.object({ fileId: Id.nullable() });
const NodeFileInput = z.object({ nodeId: Id, fileId: Id.nullable() });

export const imagesSetAvatar = defineContract({
  name: "images.setAvatar",
  summary: "Set your avatar from an unattached image you uploaded.",
  kind: "write",
  input: FileInput,
  output: ImageReference,
});
export const imagesSetCover = defineContract({
  name: "images.setCover",
  summary: "Set your profile cover from an unattached image you uploaded.",
  kind: "write",
  input: FileInput,
  output: ImageReference,
});
export const imagesSetNodeIcon = defineContract({
  name: "images.setNodeIcon",
  summary: "Set a node icon from an unattached image you uploaded. Administrators only.",
  kind: "write",
  input: NodeFileInput,
  output: ImageReference,
});
export const imagesSetNodeCover = defineContract({
  name: "images.setNodeCover",
  summary: "Set a node cover from an unattached image you uploaded. Administrators only.",
  kind: "write",
  input: NodeFileInput,
  output: ImageReference,
});
export const imagesSetAwardImage = defineContract({
  name: "images.setAwardImage",
  summary:
    "Set an award's picture from an unattached image you uploaded with the purpose " +
    "`award_image`. Requires admin.awards.",
  kind: "write",
  input: z.object({ awardId: Id, fileId: Id.nullable() }),
  output: ImageReference,
});
export const imagesSetShopItemImage = defineContract({
  name: "images.setShopItemImage",
  summary:
    "Set a shop item's picture from an unattached image you uploaded with the purpose " +
    "`shop_image`. Requires admin.shop.",
  kind: "write",
  input: z.object({ itemId: Id, fileId: Id.nullable() }),
  output: ImageReference,
});
