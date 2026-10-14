import type { ReactNode } from "react";

// What an audited read's action answers: the refusal, or the rendered view of what was read.
export type AuditedState = { error?: string; view?: ReactNode } | null;
