import { text } from "../admin/groups/form-errors";

// What the notice rows of a moderation form (see notice-fields.tsx) send, as the backend takes it.
// An empty message field is no message.
export function noticeOf(formData: FormData) {
  return {
    reason: text(formData, "reason"),
    notify: formData.get("notify") !== null,
    message: text(formData, "message").trim() || undefined,
  };
}
