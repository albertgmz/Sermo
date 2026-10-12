import "server-only";

import { cache } from "react";
import { viewerOfRequest } from "./client";

// The visitor as the backend sees them. A dead cookie or a banned account is a guest; nothing is
// written here.
export const getViewer = cache(viewerOfRequest);
