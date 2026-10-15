import { startTransition, useActionState } from "react";

// What the forms that use this hear back from their action.
export type KeptState = {
  error?: string;
  done?: boolean;
  title?: string;
  prefixId?: string;
  summary?: string;
};

// A form's action state, submitted by hand so that React does not reset the form once the action
// has answered: a refused post keeps what the member wrote.
// What empties the form is the redirect an action ends in once the post is taken: Next then draws
// the page's forms anew, so text, files and anything open (a dialog) start over.
export function useKeptForm(
  action: (previous: KeptState, formData: FormData) => Promise<KeptState>,
) {
  const [state, dispatch, pending] = useActionState(action, {});
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}
