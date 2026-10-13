import { getTranslations } from "next-intl/server";
import { receiveUpload, type UploadRefusal } from "@/lib/sermo/upload";
import { megabytes } from "@/lib/sermo/upload-limit";

const failure = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

// Takes one file for a conversation message or a profile post, which belong to no forum, and
// hands it on to the backend as the visitor through the same `receiveUpload` as the other upload
// routes (see `threads/[id]/uploads`): nothing is read before its checks pass and the body is
// streamed. The answer is the id the backend stored the file under, which the message or post
// names when it is saved; whether the member may attach it is the backend's to say, there.
export async function POST(request: Request) {
  const t = await getTranslations("forum.attachments");
  const received = await receiveUpload(request, "attachment");
  if (received.ok) {
    return Response.json(
      { id: received.fileId },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const words: Record<UploadRefusal, string> = {
    session: t("signIn"),
    origin: t("notAllowed"),
    type: t("noFile"),
    length: t("noFile"),
    size:
      received.limit === undefined
        ? t("tooLarge")
        : t("overLimit", { size: megabytes(received.limit) }),
    refused: received.message ?? t("failed"),
    failed: t("failed"),
  };
  return failure(words[received.reason], received.status);
}
