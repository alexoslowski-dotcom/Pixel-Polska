import { NextResponse } from "next/server";

type VitalMetric = {
  name?: unknown;
  value?: unknown;
  id?: unknown;
  label?: unknown;
  navigationType?: unknown;
  page?: unknown;
  ts?: unknown;
};

const ALLOWED_NAMES = new Set(["FCP", "LCP", "CLS", "INP", "TTFB"]);

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as VitalMetric;

    const name = typeof body.name === "string" ? body.name : "unknown";
    const page = typeof body.page === "string" ? body.page : "unknown";
    const value = isFiniteNumber(body.value) ? body.value : -1;

    if (!ALLOWED_NAMES.has(name)) {
      return NextResponse.json({ success: true }, { status: 202 });
    }

    console.log("[web-vitals]", {
      name,
      value,
      id: typeof body.id === "string" ? body.id : "n/a",
      page,
      label: typeof body.label === "string" ? body.label : "n/a",
      navigationType: typeof body.navigationType === "string" ? body.navigationType : "n/a",
      ts: isFiniteNumber(body.ts) ? body.ts : Date.now(),
    });

    return NextResponse.json({ success: true }, { status: 202 });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
