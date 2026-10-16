import { startTransition, useActionState, useEffect, useRef } from "react";

// What the forms that use this hear back from their action.
export type KeptState = {
  error?: string;
  done?: boolean;
  title?: string;
  prefixId?: string;
  summary?: string;
};

// A send that ended without the action answering was a redirect: an answer is a new state, and the
// state the send began with is still the state.
export function endedInRedirect(submitted: KeptState | null, state: KeptState) {
  return submitted !== null && submitted === state;
}

// A form's action state, submitted by hand so that React does not reset the form once the action
// has answered: a refused post keeps what the member wrote.
// What empties the form is the redirect an action ends in once the post is taken: Next then draws
// the page's forms anew, so text, files and anything open (a dialog) start over. A form in the
// layout does not rely on that: `onSent` is called when a send ends without the action having
// answered, which is what a redirect is, so it can close and start over by itself.
export function useKeptForm(
  action: (previous: KeptState, formData: FormData) => Promise<KeptState>,
  onSent?: () => void,
) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submitted = useRef<KeptState | null>(null);
  const sent = useRef(onSent);
  sent.current = onSent;
  useEffect(() => {
    if (pending || submitted.current === null) return;
    const redirected = endedInRedirect(submitted.current, state);
    submitted.current = null;
    if (redirected) sent.current?.();
  }, [pending, state]);
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submitted.current = state;
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}
