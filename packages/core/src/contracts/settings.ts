import * as z from "zod";
import { FILE_PURPOSES } from "../db/schema";
import { defineContract } from "../operation";
import { Empty } from "./common";

const Mime = z
  .string()
  .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i)
  .max(100);
const MimeList = z.array(Mime).max(40);
export const SiteSettings = z
  .object({
    maxUploadBytes: z.number().int().min(1).max(1_073_741_824),
    allowedUploadTypes: z.record(z.enum(FILE_PURPOSES), MimeList),
    groupUploadLimitBytes: z.record(z.string().regex(/^[1-4]$/), z.number().int().min(0)),
    firstPostsToModerate: z.number().int().min(0).max(100),
    moderateLinksFromNewMembers: z.boolean(),
    warningBanThreshold: z.number().int().min(0).max(1000),
    warningBanDays: z.number().int().min(1).max(3650),
    threadTitleTemplate: z.string().min(1).max(200),
    nodeTitleTemplate: z.string().min(1).max(200),
    profileTitleTemplate: z.string().min(1).max(200),
    indexNowKey: z.string().min(8).max(128).nullable(),
  })
  .meta({ id: "SiteSettings" });

export const settingsGet = defineContract({
  name: "settings.get",
  summary: "Get site configuration. Administrators only.",
  kind: "read",
  input: Empty,
  output: SiteSettings,
});

export const settingsUpdate = defineContract({
  name: "settings.update",
  summary: "Update site configuration. Administrators only.",
  kind: "write",
  input: SiteSettings.partial(),
  output: SiteSettings,
});
