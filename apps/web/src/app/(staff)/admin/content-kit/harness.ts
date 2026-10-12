// What the action tests of the content and communication screens share: the form data builder, the
// way a redirect is read back, and a validation refusal that names a field.
export function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

export async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

export const invalid = (field: string, message: string) =>
  Response.json(
    {
      error: {
        code: "validation",
        message: "Invalid input",
        issues: [{ path: [field], message }],
      },
    },
    { status: 422 },
  );
