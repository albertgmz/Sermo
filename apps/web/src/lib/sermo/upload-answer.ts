import { receiveUpload, type UploadRefusal } from "@/lib/sermo/upload";
import { megabytes } from "@/lib/sermo/upload-limit";
import { refusalWords } from "@/lib/sermo/upload-refusal";

// The words of an upload route's refusals. Each route reads them from its own namespace.
// (A method signature, so the routes' own typed translators fit: they take no values for the
// keys without a placeholder.)
type Words = {
  words(
    key:
      | "signIn"
      | "noFile"
      | "notAllowed"
      | "failed"
      | "tooLarge"
      | "overLimit",
    values?: { size: string },
  ): string;
}["words"];

export const uploadFailure = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

// Hands one attachment on to the backend (`receiveUpload`) and answers the way both attachment
// routes do: the id the backend stored the file under, or the refusal in the route's words.
export async function answerAttachment(request: Request, t: Words) {
  const received = await receiveUpload(request, "attachment");
  if (received.ok) {
    return Response.json(
      { id: received.fileId },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // The backend's refusal in the member's language; one it gives no cause for is a failure.
  const refused =
    received.reason === "refused" ? await refusalWords(received) : undefined;
  const words: Record<UploadRefusal, string> = {
    session: t("signIn"),
    origin: t("notAllowed"),
    type: t("noFile"),
    length: t("noFile"),
    size:
      received.limit === undefined
        ? t("tooLarge")
        : t("overLimit", { size: megabytes(received.limit) }),
    refused: refused ?? t("failed"),
    failed: t("failed"),
  };
  return uploadFailure(words[received.reason], received.status);
}
