import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type PixelRect = {
  id: string;
  clickCount?: number;
};

type ClickEvent = {
  id: string;
  ts: number;
};

const filePath = path.join(process.cwd(), "data", "pixels.json");
const eventsPath = path.join(process.cwd(), "data", "click-events.json");
const lockFilePath = path.join(process.cwd(), "data", "pixels.lock");
const CLICK_EVENTS_TTL_MS = 8 * 24 * 60 * 60 * 1000;

function withNoStoreHeaders(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function ensureFile() {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]", "utf-8");
  }

  try {
    await fs.access(eventsPath);
  } catch {
    await fs.writeFile(eventsPath, "[]", "utf-8");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureFile();
  const deadline = Date.now() + 3000;

  while (true) {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(lockFilePath, "wx");
      return await fn();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("LOCK_TIMEOUT");
      await sleep(50);
    } finally {
      if (handle) {
        await handle.close();
        await fs.unlink(lockFilePath).catch(() => {});
      }
    }
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Brak id bloku" }, { status: 400 }));
    }

    return await withFileLock(async () => {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      if (!Array.isArray(parsed)) {
        return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nieprawidlowy format danych" }, { status: 500 }));
      }

      const blocks = parsed as PixelRect[];
      const idx = blocks.findIndex((block) => block && typeof block.id === "string" && block.id === id);
      if (idx === -1) {
        return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nie znaleziono bloku" }, { status: 404 }));
      }

      const current = Number.isInteger(blocks[idx].clickCount) ? (blocks[idx].clickCount as number) : 0;
      blocks[idx] = { ...blocks[idx], clickCount: current + 1 };
      await fs.writeFile(filePath, JSON.stringify(blocks, null, 2), "utf-8");

      const eventsRaw = await fs.readFile(eventsPath, "utf-8");
      const parsedEvents = JSON.parse(eventsRaw) as unknown;
      const existingEvents = Array.isArray(parsedEvents)
        ? parsedEvents.flatMap((event): ClickEvent[] => {
            if (!event || typeof event !== "object") return [];
            const record = event as Partial<ClickEvent>;
            if (typeof record.id !== "string" || !Number.isInteger(record.ts)) return [];
            return [{ id: record.id, ts: record.ts as number }];
          })
        : [];
      const now = Date.now();
      const filteredEvents = existingEvents.filter((event) => now - event.ts <= CLICK_EVENTS_TTL_MS);
      filteredEvents.push({ id, ts: now });
      await fs.writeFile(eventsPath, JSON.stringify(filteredEvents, null, 2), "utf-8");

      return withNoStoreHeaders(NextResponse.json({ success: true, clickCount: current + 1 }));
    });
  } catch (error) {
    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(NextResponse.json({ success: false, message: "Serwer zajety, sprobuj ponownie" }, { status: 503 }));
    }
    return withNoStoreHeaders(NextResponse.json({ success: false, message: "Nie mozna zapisac klikniecia" }, { status: 500 }));
  }
}
