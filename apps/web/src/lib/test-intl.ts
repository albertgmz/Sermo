import { messages } from "@/i18n/messages";

// What `getTranslations(namespace)` gives in a test: the message as written in the messages files.
export function translator(namespace: string) {
  return (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  };
}
