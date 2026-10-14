// Sends a framed picture to the account's picture route and reads its answer. The route attaches
// the picture as the avatar or the cover as well, and always answers JSON.

export type PictureKind = "avatar" | "cover";

export type PictureAnswer =
  | { ok: true }
  | { ok: false; error: string; signIn?: boolean };

export async function uploadPicture(
  kind: PictureKind,
  file: Blob,
  name: string,
  send: typeof fetch = fetch,
): Promise<PictureAnswer> {
  const body = new FormData();
  body.set("file", file, name);
  let response: Response;
  try {
    response = await send(`/account/picture?kind=${kind}`, {
      method: "POST",
      headers: { accept: "application/json" },
      body,
    });
  } catch {
    return { ok: false, error: "" };
  }
  let answer: { error?: unknown } | null = null;
  try {
    answer = await response.json();
  } catch {
    answer = null;
  }
  if (response.ok) return { ok: true };
  return {
    ok: false,
    error: typeof answer?.error === "string" ? answer.error : "",
    ...(response.status === 401 && { signIn: true }),
  };
}
