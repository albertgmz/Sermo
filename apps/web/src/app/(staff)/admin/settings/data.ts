import "server-only";

import { settingsGet } from "@sermo/core/contracts";
import { cache } from "react";
import { read } from "@/lib/sermo/client";

// The site configuration, once per request. Only administrators with `admin.settings` get it.
export const getSettings = cache(() => read(settingsGet, {}));
