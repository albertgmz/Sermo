import { useState } from "react";
import { type KeptState, useKeptForm } from "@/components/forum/use-kept-form";
import { sendIntoTail, type TailRow, tailIsShown } from "@/lib/tail";

// A form that ends a conversation or the last page of a thread (the reply forms). While that end
// is on the screen (`tailKey`) the text shows there at once, waiting, and `send` is asked to make
// it so: its row takes the text's place, a refusal takes the text away and is shown in the form,
// which keeps what was written; `generation` changes after a send that was taken, for the form to
// start over. Without that end on the screen (an earlier page) the form sends the old way, with
// `redirecting`, an action that ends in a redirect to a page that shows the new text.
export function useTailForm({
  tailKey,
  send,
  redirecting,
  failed,
}: {
  tailKey: string;
  send: (data: FormData) => Promise<{ error?: string; row?: TailRow }>;
  redirecting: (previous: KeptState, data: FormData) => Promise<KeptState>;
  // What the form says when the server could not be reached.
  failed: string;
}) {
  const kept = useKeptForm(redirecting);
  const [inPlace, setInPlace] = useState<{
    active: boolean;
    pending: boolean;
    error?: string;
    generation: number;
  }>({ active: false, pending: false, generation: 0 });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!tailIsShown(tailKey)) {
      setInPlace((now) => ({ ...now, active: false }));
      return kept.onSubmit(event);
    }
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = String(data.get("body") ?? "");
    setInPlace((now) => ({
      ...now,
      active: true,
      pending: true,
      error: undefined,
    }));
    const settled = (error: string | undefined) =>
      setInPlace((now) => ({
        active: true,
        pending: false,
        error,
        generation: now.generation + Number(error === undefined),
      }));
    sendIntoTail(tailKey, text, () => send(data)).then(settled, () =>
      settled(failed),
    );
  }

  return {
    state: inPlace.active ? { error: inPlace.error } : kept.state,
    pending: inPlace.active ? inPlace.pending : kept.pending,
    generation: inPlace.generation,
    onSubmit,
  };
}
