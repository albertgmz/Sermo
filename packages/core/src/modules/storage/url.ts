import type { Ctx } from "../../context";

export function fileUrl(id: number): string {
  return `/api/v1/files/${id}`;
}

export function resolvedFileUrl(ctx: Ctx, id: number, cdnEligible: boolean): string {
  const path = fileUrl(id);
  return cdnEligible && ctx.config.publicFileBaseURL
    ? new URL(path, ctx.config.publicFileBaseURL).href
    : path;
}
