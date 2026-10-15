"use server";

import { searchQuery, threadsGet } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// The threads a rule editor may name, for its thread picker: the words of a title (the backend
// finds whole words, newest first) or, for a number, that thread. Anything the visitor cannot see
// is not found.
export async function findThreads(text: string) {
  const typed = text.trim();
  try {
    if (/^\d{1,10}$/.test(typed)) {
      const { thread } = await call(threadsGet, {
        threadId: Number(typed),
        countView: false,
      });
      return [{ id: thread.id, title: thread.title }];
    }
    const { items } = await call(searchQuery, {
      q: typed,
      titlesOnly: true,
      limit: 25,
    });
    // A thread can match through several posts; it is one choice.
    return [
      ...new Map(
        items.map(({ thread }) => [
          thread.id,
          { id: thread.id, title: thread.title },
        ]),
      ).values(),
    ];
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return [];
  }
}
