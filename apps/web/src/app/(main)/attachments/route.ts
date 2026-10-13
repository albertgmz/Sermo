import { getTranslations } from "next-intl/server";
import { answerAttachment } from "@/lib/sermo/upload-answer";

// Takes one file for a conversation message or a profile post, which belong to no forum, and
// hands it on to the backend as the visitor through the same `receiveUpload` as the other upload
// routes (see `threads/[id]/uploads`): nothing is read before its checks pass and the body is
// streamed. The answer is the id the backend stored the file under, which the message or post
// names when it is saved; whether the member may attach it is the backend's to say, there.
export async function POST(request: Request) {
  const t = await getTranslations("forum.attachments");
  return answerAttachment(request, t);
}
