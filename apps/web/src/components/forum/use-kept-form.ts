import { startTransition, useActionState } from "react";

// What the forms that use this hear back from their action.
export type KeptState = {
  error?: string;
  done?: boolean;
  title?: string;
  prefixId?: string;
};

// A form's action state, submitted by hand so that React does not reset the form once the action
// has answered: a refused post keeps what the member wrote.
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
