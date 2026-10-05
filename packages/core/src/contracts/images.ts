import * as z from "zod";
import { defineContract } from "../operation";
import { Id } from "./common";

const ImageSet = z.object({ fileId: Id, url: z.string() });
export const ImageReference = ImageSet.nullable();
const FileInput = z.object({ fileId: Id });
const NodeFileInput = z.object({ nodeId: Id, fileId: Id });

export const imagesSetAvatar = defineContract({
  name: "images.setAvatar",
  summary: "Set your avatar from an unattached image you uploaded.",
  kind: "write",
  input: FileInput,
  output: ImageSet,
});
export const imagesSetCover = defineContract({
  name: "images.setCover",
  summary: "Set your profile cover from an unattached image you uploaded.",
  kind: "write",
  input: FileInput,
  output: ImageSet,
});
export const imagesSetNodeIcon = defineContract({
  name: "images.setNodeIcon",
  summary: "Set a node icon from an unattached image you uploaded. Administrators only.",
  kind: "write",
  input: NodeFileInput,
  output: ImageSet,
});
export const imagesSetNodeCover = defineContract({
  name: "images.setNodeCover",
  summary: "Set a node cover from an unattached image you uploaded. Administrators only.",
  kind: "write",
  input: NodeFileInput,
  output: ImageSet,
});
