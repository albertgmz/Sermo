"use client";

import { useEffect } from "react";
import { markAlertsViewed } from "@/app/[locale]/(main)/notifications/actions";
import { viewAlerts } from "@/lib/alerts-viewed";

// Opening the alerts page marks the alerts viewed. Draws nothing.
export function AlertsViewed() {
  useEffect(() => {
    void viewAlerts(markAlertsViewed);
  }, []);
  return null;
}
