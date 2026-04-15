import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

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

function withNoStoreHeaders(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
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

    return [{
      id: record.id,
      clientId: record.clientId,
      amount: record.amount as number,
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      height: record.height as number,
      status: record.status as PaymentRecord["status"],
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

function verifyStripeSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string) {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").map((entry) => entry.trim());
  const timestampPart = parts.find((entry) => entry.startsWith("t="));
  const signatures = parts.filter((entry) => entry.startsWith("v1=")).map((entry) => entry.slice(3));
  if (!timestampPart || signatures.length === 0) return false;

  const timestamp = timestampPart.slice(2);
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return signatures.some((signature) => {
    try {
      const candidate = Buffer.from(signature, "hex");
      return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
    } catch {
      return false;
    }
  });
}

export async function POST(req: Request) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Brak STRIPE_WEBHOOK_SECRET" }, { status: 500 }));
    }

    const signature = req.headers.get("stripe-signature");
    const rawBody = await req.text();
    const isValid = verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nieprawidlowy podpis Stripe" }, { status: 400 }));
    }

    const event = JSON.parse(rawBody) as {
      type?: string;
      data?: {
        object?: {
          id?: string;
          client_reference_id?: string;
          metadata?: { paymentId?: string };
        };
      };
    };

    const eventType = typeof event.type === "string" ? event.type : "";
    const object = event.data?.object;
    const paymentId = object?.metadata?.paymentId || object?.client_reference_id || "";
    const stripeSessionId = object?.id;
    if (!paymentId) {
      return withNoStoreHeaders(NextResponse.json({ received: true }));
    }

    await withPaymentsLock(async () => {
      const payments = await readPayments();
      const index = payments.findIndex((item) => item.id === paymentId);
      if (index === -1) return;

      const current = payments[index];
      const nowIso = new Date().toISOString();

      if (eventType === "checkout.session.completed") {
        payments[index] = {
          ...current,
          status: "paid",
          paidAt: nowIso,
          stripeSessionId: typeof stripeSessionId === "string" ? stripeSessionId : current.stripeSessionId,
        };
      } else if (eventType === "checkout.session.expired") {
        if (current.status !== "paid") {
          payments[index] = {
            ...current,
            status: "expired",
            stripeSessionId: typeof stripeSessionId === "string" ? stripeSessionId : current.stripeSessionId,
          };
        }
      }

      await writePayments(payments);
    });

    return withNoStoreHeaders(NextResponse.json({ received: true }));
  } catch (error) {
    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "System platnosci jest zajety" }, { status: 503 }));
    }
    return withNoStoreHeaders(NextResponse.json({ success: false, message: "Webhook processing error" }, { status: 500 }));
  }
}

