"use client";

import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";

// The quick reply's editor at the end of a thread or a conversation: in view with the page, so its
// formatting bar comes with the page too (`LazyEditor`), and it takes what a post's Quote sends. A
// new `generation` (a reply taken in place) starts it over.
export function QuickReplyEditor({
  generation,
  placeholder,
}: {
  generation: number;
  placeholder: string;
}) {
  return (
    <LazyEditor
      bar={Toolbar}
      key={`editor-${generation}`}
      name="body"
      compact={false}
      placeholder={placeholder}
      findMembers={findMentions}
      insertEvent={QUOTE_EVENT}
    />
  );
}
