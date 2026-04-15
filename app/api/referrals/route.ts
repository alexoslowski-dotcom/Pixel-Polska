import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type ReferralRecord = {
  code: string;
  claimers: string[];
  updatedAt: string;
};

const filePath = path.join(process.cwd(), "data", "referrals.json");
const lockPath = path.join(process.cwd(), "data", "referrals.lock");

function withNoStoreHeaders(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string") return "";
  const next = value.trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(next) ? next : "";
}

function normalizeClientId(value: unknown) {
  if (typeof value !== "string") return "";
  const next = value.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(next) ? next : "";
}

async function ensureFile() {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]", "utf-8");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureFile();
  const deadline = Date.now() + 3000;
  while (true) {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(lockPath, "wx");
      return await fn();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("LOCK_TIMEOUT");
      await sleep(50);
    } finally {
      if (handle) {
        await handle.close();
        await fs.unlink(lockPath).catch(() => {});
      }
    }
  }
}

function normalizeRecords(value: unknown): ReferralRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ReferralRecord[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<ReferralRecord>;
    const code = normalizeCode(record.code);
    const claimers = Array.isArray(record.claimers)
      ? record.claimers.filter((c): c is string => typeof c === "string" && /^[a-zA-Z0-9_-]{6,80}$/.test(c))
      : [];
    if (!code) return [];
    return [{ code, claimers: [...new Set(claimers)], updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString() }];
  });
}

export async function GET(req: Request) {
  try {
    const code = normalizeCode(new URL(req.url).searchParams.get("code"));
    if (!code) return withNoStoreHeaders(NextResponse.json({ success: false, message: "Brak kodu" }, { status: 400 }));
    await ensureFile();
    const raw = await fs.readFile(filePath, "utf-8");
    const records = normalizeRecords(JSON.parse(raw) as unknown);
    const found = records.find((item) => item.code === code);
    return withNoStoreHeaders(NextResponse.json({ success: true, code, claims: found?.claimers.length ?? 0 }));
  } catch {
    return withNoStoreHeaders(NextResponse.json({ success: false, claims: 0 }, { status: 500 }));
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { code?: unknown; claimerId?: unknown; ownerCode?: unknown };
    const code = normalizeCode(body.code);
    const claimerId = normalizeClientId(body.claimerId);
    const ownerCode = normalizeCode(body.ownerCode);
    if (!code || !claimerId) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nieprawidlowe dane" }, { status: 400 }));
    }
    if (ownerCode && ownerCode === code) {
      return withNoStoreHeaders(NextResponse.json({ success: true, ignored: true }));
    }

    return await withLock(async () => {
      const raw = await fs.readFile(filePath, "utf-8");
      const records = normalizeRecords(JSON.parse(raw) as unknown);
      const idx = records.findIndex((item) => item.code === code);
      if (idx === -1) {
        records.push({ code, claimers: [claimerId], updatedAt: new Date().toISOString() });
      } else {
        const nextClaimers = new Set(records[idx].claimers);
        nextClaimers.add(claimerId);
        records[idx] = {
          ...records[idx],
          claimers: [...nextClaimers],
          updatedAt: new Date().toISOString(),
        };
      }
      await fs.writeFile(filePath, JSON.stringify(records, null, 2), "utf-8");
      const row = records.find((item) => item.code === code);
      return withNoStoreHeaders(NextResponse.json({ success: true, code, claims: row?.claimers.length ?? 0 }));
    });
  } catch (error) {
    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Serwer zajety" }, { status: 503 }));
    }
    return withNoStoreHeaders(NextResponse.json({ success: false, message: "Blad zapisu polecenia" }, { status: 500 }));
  }
}
