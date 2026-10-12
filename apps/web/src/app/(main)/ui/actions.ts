"use server";

import { createElement, type ReactNode } from "react";
import { Markdown } from "@/components/forum/markdown";

export async function discard(_formData: FormData) {}

export async function echoMarkdown(_previous: ReactNode, formData: FormData) {
  const body = String(formData.get("body") ?? "");
  return body ? createElement(Markdown, null, body) : null;
}
