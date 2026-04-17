import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolveClientId } from "../../_shared/clientIdentity";

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
};

const paymentsFilePath = path.join(process.cwd(), "data", "payments.json");

function getClientId(req: Request) {
  return resolveClientId(req);
}

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

export async function GET(req: Request) {
  try {
    const requesterId = getClientId(req);
    await ensurePaymentsFile();
    const content = await fs.readFile(paymentsFilePath, "utf-8");
    const parsed = normalizePayments(JSON.parse(content) as unknown);
    const items = parsed
      .filter((payment) => payment.clientId === requesterId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 20)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
        expiresAt: payment.expiresAt,
        consumedAt: payment.consumedAt,
        rect: {
          x: payment.x,
          y: payment.y,
          width: payment.width,
          height: payment.height,
        },
        invoiceNo: `FV-${payment.id.slice(-8).toUpperCase()}`,
      }));

    return withNoStoreHeaders(NextResponse.json({ success: true, items }));
  } catch {
    return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nie mozna pobrac historii platnosci" }, { status: 500 }));
  }
}
