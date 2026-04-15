import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type PixelRect = {
  id?: unknown;
  image?: unknown;
  title?: unknown;
  url?: unknown;
};

type ClickEvent = {
  id: string;
  ts: number;
};

const pixelsPath = path.join(process.cwd(), "data", "pixels.json");
const eventsPath = path.join(process.cwd(), "data", "click-events.json");
const DAY_MS = 24 * 60 * 60 * 1000;

function withNoStoreHeaders(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function ensureFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]", "utf-8");
  }
}

function normalizeEvents(value: unknown): ClickEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((event): ClickEvent[] => {
    if (!event || typeof event !== "object") return [];
    const record = event as Partial<ClickEvent>;
    if (typeof record.id !== "string" || !Number.isInteger(record.ts)) return [];
    return [{ id: record.id, ts: record.ts as number }];
  });
}

export async function GET() {
  try {
    await ensureFile(pixelsPath);
    await ensureFile(eventsPath);

    const [pixelsRaw, eventsRaw] = await Promise.all([
      fs.readFile(pixelsPath, "utf-8"),
      fs.readFile(eventsPath, "utf-8"),
    ]);

    const blocksRaw = JSON.parse(pixelsRaw) as unknown;
    const events = normalizeEvents(JSON.parse(eventsRaw) as unknown);
    const blocks = Array.isArray(blocksRaw) ? blocksRaw : [];
    const blockMeta = new Map<string, { image: string; title?: string; url?: string }>();

    for (const item of blocks) {
      if (!item || typeof item !== "object") continue;
      const block = item as PixelRect;
      const id = typeof block.id === "string" ? block.id : "";
      const image = typeof block.image === "string" ? block.image : "";
      if (!id || !image) continue;
      blockMeta.set(id, {
        image,
        title: typeof block.title === "string" ? block.title : undefined,
        url: typeof block.url === "string" ? block.url : undefined,
      });
    }

    const now = Date.now();
    const from24h = now - DAY_MS;
    const from7d = now - 7 * DAY_MS;
    const counts24h = new Map<string, number>();
    const counts7d = new Map<string, number>();

    for (const event of events) {
      if (!blockMeta.has(event.id)) continue;
      if (event.ts >= from7d) {
        counts7d.set(event.id, (counts7d.get(event.id) ?? 0) + 1);
      }
      if (event.ts >= from24h) {
        counts24h.set(event.id, (counts24h.get(event.id) ?? 0) + 1);
      }
    }

    const toItems = (source: Map<string, number>) =>
      [...source.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .flatMap(([id, clicks]) => {
          const meta = blockMeta.get(id);
          if (!meta) return [];
          return [{
            id,
            clicks,
            image: meta.image,
            title: meta.title,
            url: meta.url,
          }];
        });

    return withNoStoreHeaders(NextResponse.json({
      success: true,
      top24h: toItems(counts24h),
      top7d: toItems(counts7d),
    }));
  } catch {
    return withNoStoreHeaders(NextResponse.json({ success: false, top24h: [], top7d: [] }, { status: 500 }));
  }
}
