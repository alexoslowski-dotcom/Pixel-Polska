import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolveClientId } from "../_shared/clientIdentity";

type PaymentRecord = {
  id: string;
  clientId: string;
  amount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: "pending" | "paid" | "failed" | "expired";
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  consumedAt?: string;
  stripeSessionId?: string;
};

const paymentsFilePath = path.join(process.cwd(), "data", "payments.json");
const paymentsLockPath = path.join(process.cwd(), "data", "payments.lock");
const PAYMENT_TTL_MS = 35 * 60 * 1000;

function getClientId(req: Request) {
  return resolveClientId(req);
}

function withNoStoreHeaders(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function makePaymentId() {
  const idPart = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `pay_${idPart.replace(/-/g, "")}`;
}

function resolveAppUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}

async function createStripeCheckoutSession(req: Request, payment: PaymentRecord) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecretKey) {
    return { ok: false as const, message: "Brak konfiguracji STRIPE_SECRET_KEY" };
  }

  const appUrl = resolveAppUrl(req);
  const successUrl = `${appUrl}/?paymentId=${encodeURIComponent(payment.id)}&checkout=success`;
  const cancelUrl = `${appUrl}/?paymentId=${encodeURIComponent(payment.id)}&checkout=cancel`;
  const minStripeExpiresAtMs = Date.now() + 30 * 60 * 1000 + 30_000;
  const expiresAtMs = Math.max(Date.parse(payment.expiresAt), minStripeExpiresAtMs);
  const expiresAtSeconds = Math.floor(expiresAtMs / 1000);

  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("client_reference_id", payment.id);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "pln");
  body.set("line_items[0][price_data][unit_amount]", String(payment.amount * 100));
  body.set("line_items[0][price_data][product_data][name]", `Pixelarnia ${payment.width}x${payment.height}`);
  body.set("line_items[0][price_data][product_data][description]", `Obszar: ${payment.width}x${payment.height} @ ${payment.x},${payment.y}`);
  body.set("metadata[paymentId]", payment.id);
  body.set("metadata[clientId]", payment.clientId);
  body.set("metadata[x]", String(payment.x));
  body.set("metadata[y]", String(payment.y));
  body.set("metadata[width]", String(payment.width));
  body.set("metadata[height]", String(payment.height));
  body.set("expires_at", String(expiresAtSeconds));

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const stripePayload = (await stripeRes.json()) as { url?: string; id?: string; error?: { message?: string } };
  if (!stripeRes.ok || !stripePayload.url || !stripePayload.id) {
    return {
      ok: false as const,
      message: stripePayload.error?.message || "Nie mozna utworzyc sesji Stripe",
    };
  }

  return {
    ok: true as const,
    checkoutUrl: stripePayload.url,
    stripeSessionId: stripePayload.id,
  };
}

async function readStripeCheckoutSession(stripeSessionId: string) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecretKey) return null;

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(stripeSessionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
    },
    cache: "no-store",
  });

  if (!stripeRes.ok) return null;
  const payload = (await stripeRes.json()) as {
    status?: "open" | "complete" | "expired";
    payment_status?: "paid" | "unpaid" | "no_payment_required";
  };
  return payload;
}

function normalizePayments(value: unknown): PaymentRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PaymentRecord[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<PaymentRecord>;
    if (
      typeof record.id !== "string" ||
      typeof record.clientId !== "string" ||
      !Number.isInteger(record.amount) ||
      !Number.isInteger(record.x) ||
      !Number.isInteger(record.y) ||
      !Number.isInteger(record.width) ||
      !Number.isInteger(record.height) ||
      typeof record.status !== "string" ||
      typeof record.createdAt !== "string" ||
      typeof record.expiresAt !== "string"
    ) {
      return [];
    }

    if (!["pending", "paid", "failed", "expired"].includes(record.status)) return [];

    const amount = record.amount as number;
    const x = record.x as number;
    const y = record.y as number;
    const width = record.width as number;
    const height = record.height as number;
    const status = record.status as PaymentRecord["status"];

    return [{
      id: record.id,
      clientId: record.clientId,
      amount,
      x,
      y,
      width,
      height,
      status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      paidAt: typeof record.paidAt === "string" ? record.paidAt : undefined,
      consumedAt: typeof record.consumedAt === "string" ? record.consumedAt : undefined,
      stripeSessionId: typeof record.stripeSessionId === "string" ? record.stripeSessionId : undefined,
    }];
  });
}

async function ensurePaymentsFile() {
  await fs.mkdir(path.dirname(paymentsFilePath), { recursive: true });
  try {
    await fs.access(paymentsFilePath);
  } catch {
    await fs.writeFile(paymentsFilePath, "[]", "utf-8");
  }
}

async function readPayments() {
  await ensurePaymentsFile();
  const fileContent = await fs.readFile(paymentsFilePath, "utf-8");
  const parsed = JSON.parse(fileContent) as unknown;
  return normalizePayments(parsed);
}

async function writePayments(payments: PaymentRecord[]) {
  await fs.writeFile(paymentsFilePath, JSON.stringify(payments, null, 2), "utf-8");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPaymentsLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensurePaymentsFile();
  const deadline = Date.now() + 3000;

  while (true) {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(paymentsLockPath, "wx");
      return await fn();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("LOCK_TIMEOUT");
      await sleep(50);
    } finally {
      if (handle) {
        await handle.close();
        await fs.unlink(paymentsLockPath).catch(() => {});
      }
    }
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const paymentId = url.searchParams.get("paymentId")?.trim();
    if (!paymentId) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Brak paymentId" }, { status: 400 }));
    }

    const requesterId = getClientId(req);
    const nowMs = Date.now();
    const payments = await readPayments();
    const payment = payments.find((item) => item.id === paymentId && item.clientId === requesterId);
    if (!payment) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nie znaleziono platnosci" }, { status: 404 }));
    }

    let status = payment.status;
    if (status === "pending" && Date.parse(payment.expiresAt) <= nowMs) status = "expired";

    if (status === "pending" && payment.stripeSessionId) {
      const stripeSession = await readStripeCheckoutSession(payment.stripeSessionId);
      if (stripeSession?.payment_status === "paid") {
        status = "paid";
      } else if (stripeSession?.status === "expired") {
        status = "expired";
      }

      if (status !== payment.status) {
        await withPaymentsLock(async () => {
          const all = await readPayments();
          const idx = all.findIndex((item) => item.id === payment.id);
          if (idx === -1) return;
          const current = all[idx];
          all[idx] = {
            ...current,
            status,
            paidAt: status === "paid" ? (current.paidAt ?? new Date().toISOString()) : current.paidAt,
          };
          await writePayments(all);
        });
      }
    }
    return withNoStoreHeaders(
      NextResponse.json({
        success: true,
        status,
        amount: payment.amount,
        rect: {
          x: payment.x,
          y: payment.y,
          width: payment.width,
          height: payment.height,
        },
      })
    );
  } catch {
    return withNoStoreHeaders(NextResponse.json({ success: false, message: "Blad odczytu platnosci" }, { status: 500 }));
  }
}

export async function POST(req: Request) {
  try {
    const requesterId = getClientId(req);
    const body = (await req.json()) as {
      amount?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    if (
      !Number.isInteger(body.amount) ||
      !Number.isInteger(body.x) ||
      !Number.isInteger(body.y) ||
      !Number.isInteger(body.width) ||
      !Number.isInteger(body.height)
    ) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nieprawidlowe dane platnosci" }, { status: 400 }));
    }

    const amount = body.amount as number;
    const x = body.x as number;
    const y = body.y as number;
    const width = body.width as number;
    const height = body.height as number;
    const expected = width * height;

    if (amount !== expected || amount <= 0) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Kwota nie zgadza sie z rozmiarem" }, { status: 400 }));
    }

    const now = new Date();
    const payment: PaymentRecord = {
      id: makePaymentId(),
      clientId: requesterId,
      amount,
      x,
      y,
      width,
      height,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS).toISOString(),
    };

    let checkoutUrl = "";

    await withPaymentsLock(async () => {
      const payments = await readPayments();
      const fresh = payments.filter((item) => Date.parse(item.expiresAt) > Date.now() || item.status === "paid");
      const session = await createStripeCheckoutSession(req, payment);
      if (!session.ok) {
        throw new Error(`STRIPE_CREATE_FAILED:${session.message}`);
      }

      checkoutUrl = session.checkoutUrl;
      const nextPayment: PaymentRecord = {
        ...payment,
        stripeSessionId: session.stripeSessionId,
      };
      await writePayments([...fresh, nextPayment]);
    });

    return withNoStoreHeaders(NextResponse.json({ success: true, paymentId: payment.id, checkoutUrl }));
  } catch (error) {
    if ((error as Error).message.startsWith("STRIPE_CREATE_FAILED:")) {
      const msg = (error as Error).message.replace("STRIPE_CREATE_FAILED:", "").trim();
      return withNoStoreHeaders(NextResponse.json({ success: false, message: msg || "Blad Stripe" }, { status: 502 }));
    }
    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "System platnosci jest zajety, sprobuj ponownie" }, { status: 503 }));
    }
    return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nie udalo sie utworzyc platnosci" }, { status: 500 }));
  }
}

