"use client";

import { Quote } from "lucide-react";
import { quoteOf } from "@/components/forum/bb-text";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";

// Puts a post, quoted, at the end of the reply editor (which listens for `event`) and takes the
// member there. The BB code source comes from the backend, never from the rendered post. `label`
// names the button; `text`, when given, is the word drawn beside the icon in its place. `reference`
// says what `postId` is: a post, or a conversation message (`convMessage`).
export function QuoteButton({
  postId,
  event,
  load,
  label,
  text = label,
  labelClassName = actionLabelClass,
  reference,
}: {
  postId: number;
  event: string;
  load: (
    postId: number,
  ) => Promise<{ author: string; authorId: number; source: string } | null>;
  label: string;
  text?: string;
  // How the word is hidden where only the icon fits.
  labelClassName?: string;
  reference?: "post" | "convMessage";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={messageActionClass}
      onClick={async () => {
        const post = await load(postId);
        if (!post) return;
        window.dispatchEvent(
          new CustomEvent(event, {
            detail: quoteOf(
              postId,
              post.author,
              post.authorId,
              post.source,
              reference,
            ),
          }),
        );
        document.getElementById("reply")?.scrollIntoView({ block: "start" });
      }}
    >
      <Quote />
      <span className={labelClassName}>{text}</span>
    </button>
  );
}
