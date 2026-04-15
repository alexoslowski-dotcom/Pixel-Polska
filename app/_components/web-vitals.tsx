"use client";

import { useReportWebVitals } from "next/web-vitals";

export function WebVitals() {
  useReportWebVitals((metric) => {
    const payload = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      label: metric.rating,
      navigationType: metric.navigationType,
      page: window.location.pathname,
      ts: Date.now(),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", payload);
      return;
    }

    void fetch("/api/analytics", {
      method: "POST",
      body: payload,
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  return null;
}
