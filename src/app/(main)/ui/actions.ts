"use server";

export async function discard(_formData: FormData) {}

export async function echoMarkdown(_previous: string, formData: FormData) {
  return String(formData.get("body") ?? "");
}
