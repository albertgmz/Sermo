"use client";

import { Quote } from "lucide-react";
import { messageActionClass } from "@/components/forum/message-action";
import { quoteOf } from "@/components/forum/quote-text";

// Puts a post, quoted, at the end of the reply editor (which listens for `event`) and takes the
// member there. The Markdown source comes from the backend, never from the rendered post.
export function QuoteButton({
  postId,
  event,
  load,
  label,
}: {
  postId: number;
  event: string;
  load: (postId: number) => Promise<{ author: string; source: string } | null>;
  label: string;
}) {
  return (
    <button
      type="button"
      className={messageActionClass}
      onClick={async () => {
        const post = await load(postId);
        if (!post) return;
        window.dispatchEvent(
          new CustomEvent(event, {
            detail: quoteOf(postId, post.author, post.source),
          }),
        );
        document.getElementById("reply")?.scrollIntoView({ block: "start" });
      }}
    >
      <Quote />
      {label}
    </button>
  );
}
