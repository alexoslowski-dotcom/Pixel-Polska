import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { timingSafeEqual } from "crypto";
import path from "path";
import { moderateImageDataUrl } from "../_shared/imageModeration";
import { resolveClientId } from "../_shared/clientIdentity";

type PixelRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image: string;
  url?: string;
  title?: string;
  status: "approved" | "pending" | "rejected";
  reportCount: number;
  clickCount: number;
  ownerClientId?: string;
  ownerName?: string;
  ownerAvatar?: string;
  createdAt: string;
};

type PixelReservation = {
  id: string;
  clientId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
  expiresAt: string;
};

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

type RateEntry = {
  count: number;
  resetAt: number;
};

const GRID_COLUMNS = 1000;
const GRID_ROWS = 1000;
const TOTAL_PIXELS = GRID_COLUMNS * GRID_ROWS;

const MAX_IMAGE_CHARS = 1_500_000;
const MAX_BODY_BYTES = 2_000_000;
const RESERVATION_TTL_MS = 2 * 60 * 1000;
const MAX_RESERVED_PIXELS_PER_CLIENT = 250_000;
const MIN_PURCHASE_SIZE = 10;
const MAX_TITLE_LENGTH = 80;
const MAX_OWNER_NAME_LENGTH = 32;
const MAX_OWNER_AVATAR_LENGTH = 8;

function makeBlockId() {
  const idPart = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `block_${idPart.replace(/-/g, "")}`;
}

function normalizeOptionalText(value: unknown, maxLen: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function normalizeOptionalUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const filePath = path.join(process.cwd(), "data", "pixels.json");
const reservationsFilePath = path.join(process.cwd(), "data", "reservations.json");
const lockFilePath = path.join(process.cwd(), "data", "pixels.lock");
const paymentsFilePath = path.join(process.cwd(), "data", "payments.json");

const rateBuckets = new Map<string, RateEntry>();
const viewerLastSeen = new Map<string, number>();
const ACTIVE_VIEWER_WINDOW_MS = 30_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return "unknown";
}

function getClientId(req: Request) {
  return resolveClientId(req);
}

function enforceRateLimit(req: Request, action: "read" | "write") {
  const now = Date.now();
  const ip = getClientIp(req);
  const max = action === "read" ? 240 : 60;
  const windowMs = 60_000;
  const key = `${action}:${ip}`;

  const current = rateBuckets.get(key);

  if (!current || now > current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= max) {
    return NextResponse.json(
      {
        success: false,
        message: "Za duzo zapytan, sprobuj ponownie za chwile",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)),
        },
      }
    );
  }

  current.count += 1;
  return null;
}

function withNoStoreHeaders(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function isValidResetToken(req: Request) {
  const configuredToken = process.env.PIXEL_RESET_TOKEN?.trim();
  if (!configuredToken) return false;

  const providedToken = req.headers.get("x-admin-reset-token")?.trim() ?? "";
  if (!providedToken) return false;

  const a = Buffer.from(configuredToken);
  const b = Buffer.from(providedToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function trackAndCountActiveViewers(req: Request) {
  const now = Date.now();
  const viewerKey = getClientId(req);
  viewerLastSeen.set(viewerKey, now);

  for (const [key, ts] of viewerLastSeen.entries()) {
    if (now - ts > ACTIVE_VIEWER_WINDOW_MS) {
      viewerLastSeen.delete(key);
    }
  }

  return viewerLastSeen.size;
}

async function ensureDataDir() {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function ensureFile() {
  await ensureDataDir();

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]", "utf-8");
  }
}

async function ensureReservationsFile() {
  await ensureDataDir();

  try {
    await fs.access(reservationsFilePath);
  } catch {
    await fs.writeFile(reservationsFilePath, "[]", "utf-8");
  }
}

async function ensureStorageFiles() {
  await ensureFile();
  await ensureReservationsFile();
  await ensurePaymentsFile();
}

async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureDataDir();

  const deadline = Date.now() + 3000;

  while (true) {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;

    try {
      handle = await fs.open(lockFilePath, "wx");
      return await fn();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      if (Date.now() >= deadline) {
        throw new Error("LOCK_TIMEOUT");
      }

      await sleep(50);
    } finally {
      if (handle) {
        await handle.close();
        await fs.unlink(lockFilePath).catch(() => {});
      }
    }
  }
}

function normalizeInteger(value: unknown) {
  return Number.isInteger(value) ? (value as number) : null;
}

function rectangleFromPixels(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const intPixels = value.filter((pixel): pixel is number => Number.isInteger(pixel));

  if (intPixels.length !== value.length) {
    return null;
  }

  if (intPixels.some((pixel) => pixel < 0 || pixel >= TOTAL_PIXELS)) {
    return null;
  }

  const unique = [...new Set(intPixels)];
  const xs = unique.map((p) => p % GRID_COLUMNS);
  const ys = unique.map((p) => Math.floor(p / GRID_COLUMNS));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  if (unique.length !== width * height) {
    return null;
  }

  const check = new Set(unique);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!check.has(y * GRID_COLUMNS + x)) {
        return null;
      }
    }
  }

  return { x: minX, y: minY, width, height };
}

function validateRectangle(value: unknown) {
  if (!value || typeof value !== "object") {
    return { ok: false as const, message: "Brak danych prostokata" };
  }

  const raw = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };

  const x = normalizeInteger(raw.x);
  const y = normalizeInteger(raw.y);
  const width = normalizeInteger(raw.width);
  const height = normalizeInteger(raw.height);

  if (x === null || y === null || width === null || height === null) {
    return { ok: false as const, message: "Pola x,y,width,height musza byc liczbami calkowitymi" };
  }

  if (width <= 0 || height <= 0) {
    return { ok: false as const, message: "Szerokosc i wysokosc musza byc dodatnie" };
  }

  if (x < 0 || y < 0 || x >= GRID_COLUMNS || y >= GRID_ROWS) {
    return { ok: false as const, message: "Prostokat wychodzi poza plansze" };
  }

  if (x + width > GRID_COLUMNS || y + height > GRID_ROWS) {
    return { ok: false as const, message: "Prostokat wychodzi poza plansze" };
  }

  return { ok: true as const, rect: { x, y, width, height } };
}

function validateImage(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false as const, message: "Brak obrazka" };
  }

  if (!value.startsWith("data:image/") || !value.includes(";base64,")) {
    return { ok: false as const, message: "Nieprawidlowy format obrazka" };
  }

  if (value.length > MAX_IMAGE_CHARS) {
    return { ok: false as const, message: "Obrazek jest za duzy" };
  }

  return { ok: true as const, image: value };
}

function rectanglesOverlap(a: Pick<PixelRect, "x" | "y" | "width" | "height">, b: Pick<PixelRect, "x" | "y" | "width" | "height">) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function normalizeBlocks(value: unknown): PixelRect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): PixelRect[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as {
      id?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      pixels?: unknown;
      image?: unknown;
      url?: unknown;
      title?: unknown;
      status?: unknown;
      reportCount?: unknown;
      clickCount?: unknown;
      ownerClientId?: unknown;
      ownerName?: unknown;
      ownerAvatar?: unknown;
      createdAt?: unknown;
    };

    const image = typeof record.image === "string" ? record.image : null;
    if (!image) {
      return [];
    }

    const rectValidation = validateRectangle(record);
    const fromPixels = rectangleFromPixels(record.pixels);

    const rect = rectValidation.ok ? rectValidation.rect : fromPixels;
    if (!rect) {
      return [];
    }

    const statusRaw = typeof record.status === "string" ? record.status : "approved";
    const status: PixelRect["status"] =
      statusRaw === "approved" || statusRaw === "pending" || statusRaw === "rejected"
        ? statusRaw
        : "approved";
    const reportCount = Number.isInteger(record.reportCount) ? Math.max(0, Number(record.reportCount)) : 0;
    const clickCount = Number.isInteger(record.clickCount) ? Math.max(0, Number(record.clickCount)) : 0;

    return [
      {
        id: typeof record.id === "string" ? record.id : makeBlockId(),
        ...rect,
        image,
        url: normalizeOptionalUrl(record.url) ?? undefined,
        title: normalizeOptionalText(record.title, MAX_TITLE_LENGTH),
        status,
        reportCount,
        clickCount,
        ownerClientId: typeof record.ownerClientId === "string" ? record.ownerClientId : undefined,
        ownerName: normalizeOptionalText(record.ownerName, MAX_OWNER_NAME_LENGTH),
        ownerAvatar: normalizeOptionalText(record.ownerAvatar, MAX_OWNER_AVATAR_LENGTH),
        createdAt:
          typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt))
            ? record.createdAt
            : new Date().toISOString(),
      },
    ];
  });
}

function normalizeReservations(value: unknown): PixelReservation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): PixelReservation[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as {
      id?: unknown;
      clientId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      createdAt?: unknown;
      expiresAt?: unknown;
    };

    const rectValidation = validateRectangle(record);
    if (!rectValidation.ok) {
      return [];
    }

    const id = typeof record.id === "string" ? record.id : "";
    const clientId = typeof record.clientId === "string" ? record.clientId : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : "";

    if (!id || !clientId || Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(expiresAt))) {
      return [];
    }

    return [
      {
        id,
        clientId,
        ...rectValidation.rect,
        createdAt,
        expiresAt,
      },
    ];
  });
}

function normalizePayments(value: unknown): PaymentRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): PaymentRecord[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

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

    if (!["pending", "paid", "failed", "expired"].includes(record.status)) {
      return [];
    }

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
    }];
  });
}

function isReservationActive(reservation: PixelReservation, nowMs: number) {
  return Date.parse(reservation.expiresAt) > nowMs;
}

function pruneExpiredReservations(reservations: PixelReservation[], nowMs: number) {
  return reservations.filter((reservation) => isReservationActive(reservation, nowMs));
}

async function readBlocks() {
  const fileContent = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(fileContent) as unknown;
  return normalizeBlocks(parsed);
}

async function writeBlocks(blocks: PixelRect[]) {
  await fs.writeFile(filePath, JSON.stringify(blocks, null, 2), "utf-8");
}

async function readReservations() {
  const fileContent = await fs.readFile(reservationsFilePath, "utf-8");
  const parsed = JSON.parse(fileContent) as unknown;
  return normalizeReservations(parsed);
}

async function writeReservations(reservations: PixelReservation[]) {
  await fs.writeFile(reservationsFilePath, JSON.stringify(reservations, null, 2), "utf-8");
}

async function ensurePaymentsFile() {
  await ensureDataDir();

  try {
    await fs.access(paymentsFilePath);
  } catch {
    await fs.writeFile(paymentsFilePath, "[]", "utf-8");
  }
}

async function readPayments() {
  const fileContent = await fs.readFile(paymentsFilePath, "utf-8");
  const parsed = JSON.parse(fileContent) as unknown;
  return normalizePayments(parsed);
}

async function writePayments(payments: PaymentRecord[]) {
  await fs.writeFile(paymentsFilePath, JSON.stringify(payments, null, 2), "utf-8");
}

export async function GET(req: Request) {
  try {
    const rateError = enforceRateLimit(req, "read");
    if (rateError) {
      return withNoStoreHeaders(rateError);
    }

    await ensureStorageFiles();
    const data = await readBlocks();
    const requesterId = getClientId(req);
    const searchParams = new URL(req.url).searchParams;
    const includeMine = searchParams.get("mine") === "1";
    const nowMs = Date.now();
    const reservations = pruneExpiredReservations(await readReservations(), nowMs);
    const activeViewers = trackAndCountActiveViewers(req);

    return withNoStoreHeaders(
      NextResponse.json({
        grid: {
          columns: GRID_COLUMNS,
          rows: GRID_ROWS,
          totalPixels: TOTAL_PIXELS,
        },
        blocks: data.filter((block) => block.status === "approved"),
        myBlocks: includeMine
          ? data
              .filter((block) => block.ownerClientId === requesterId)
              .map((block) => ({
                id: block.id,
                x: block.x,
                y: block.y,
                width: block.width,
                height: block.height,
                image: block.image,
                url: block.url,
                title: block.title,
                createdAt: block.createdAt,
                clickCount: block.clickCount,
                ownerName: block.ownerName,
                ownerAvatar: block.ownerAvatar,
              }))
          : [],
        activeViewers,
        reservations: reservations.map((reservation) => ({
          id: reservation.id,
          x: reservation.x,
          y: reservation.y,
          width: reservation.width,
          height: reservation.height,
          expiresAt: reservation.expiresAt,
          ownedByRequester: reservation.clientId === requesterId,
        })),
      })
    );
  } catch (error) {
    console.error("GET error:", error);
    return withNoStoreHeaders(
      NextResponse.json(
        {
          grid: { columns: GRID_COLUMNS, rows: GRID_ROWS, totalPixels: TOTAL_PIXELS },
          blocks: [],
          reservations: [],
        },
        { status: 200 }
      )
    );
  }
}

export async function POST(req: Request) {
  try {
    const rateError = enforceRateLimit(req, "write");
    if (rateError) {
      return withNoStoreHeaders(rateError);
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Zbyt duzy payload",
          },
          { status: 413 }
        )
      );
    }

    const body = (await req.json()) as {
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      pixels?: unknown;
      image?: unknown;
      url?: unknown;
      title?: unknown;
      ownerName?: unknown;
      ownerAvatar?: unknown;
      paymentId?: unknown;
    };

    let rectValidation = validateRectangle(body);

    if (!rectValidation.ok && body.pixels !== undefined) {
      const fromPixels = rectangleFromPixels(body.pixels);
      if (fromPixels) {
        rectValidation = { ok: true as const, rect: fromPixels };
      }
    }

    if (!rectValidation.ok) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: rectValidation.message,
          },
          { status: 400 }
        )
      );
    }

    if (rectValidation.rect.width < MIN_PURCHASE_SIZE || rectValidation.rect.height < MIN_PURCHASE_SIZE) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: `Minimalny rozmiar zakupu to ${MIN_PURCHASE_SIZE}x${MIN_PURCHASE_SIZE}`,
          },
          { status: 400 }
        )
      );
    }

    const imageValidation = validateImage(body.image);
    if (!imageValidation.ok) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: imageValidation.message,
          },
          { status: 400 }
        )
      );
    }

    const moderation = await moderateImageDataUrl(imageValidation.image);
    if (!moderation.allowed) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: moderation.reason || "Obraz nie przeszedl automatycznej moderacji.",
          },
          { status: 422 }
        )
      );
    }

    const url = normalizeOptionalUrl(body.url);
    if (url === null) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Nieprawidlowy URL. Uzyj http:// lub https://",
          },
          { status: 400 }
        )
      );
    }

    const title = normalizeOptionalText(body.title, MAX_TITLE_LENGTH);
    const ownerName = normalizeOptionalText(body.ownerName, MAX_OWNER_NAME_LENGTH);
    const ownerAvatar = normalizeOptionalText(body.ownerAvatar, MAX_OWNER_AVATAR_LENGTH);
    const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
    if (!paymentId) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Brak potwierdzonej platnosci",
          },
          { status: 402 }
        )
      );
    }

    const requesterId = getClientId(req);

    return await withFileLock(async () => {
      await ensureStorageFiles();

      const saved = await readBlocks();
      const nowMs = Date.now();
      const activeReservations = pruneExpiredReservations(await readReservations(), nowMs);
      const payments = await readPayments();
      const paymentIndex = payments.findIndex((payment) => payment.id === paymentId && payment.clientId === requesterId);
      if (paymentIndex === -1) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Platnosc nie istnieje lub nie nalezy do Ciebie",
            },
            { status: 402 }
          )
        );
      }

      const payment = payments[paymentIndex];
      if (payment.consumedAt) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Ta platnosc zostala juz wykorzystana",
            },
            { status: 409 }
          )
        );
      }

      if (Date.parse(payment.expiresAt) <= nowMs) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Platnosc wygasla. Sprobuj ponownie.",
            },
            { status: 402 }
          )
        );
      }

      if (payment.status !== "paid") {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Platnosc nie jest potwierdzona",
            },
            { status: 402 }
          )
        );
      }

      const amount = rectValidation.rect.width * rectValidation.rect.height;
      const sameRect =
        payment.x === rectValidation.rect.x &&
        payment.y === rectValidation.rect.y &&
        payment.width === rectValidation.rect.width &&
        payment.height === rectValidation.rect.height;

      if (!sameRect || payment.amount !== amount) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Platnosc nie pasuje do aktualnego zaznaczenia",
            },
            { status: 400 }
          )
        );
      }

      const conflict = saved.some((block) => block.status !== "rejected" && rectanglesOverlap(block, rectValidation.rect));
      if (conflict) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Te piksele sa juz zajete",
            },
            { status: 409 }
          )
        );
      }

      const reservedByOther = activeReservations.some(
        (reservation) =>
          reservation.clientId !== requesterId && rectanglesOverlap(reservation, rectValidation.rect)
      );
      if (reservedByOther) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Ten obszar jest chwilowo zarezerwowany przez innego uzytkownika",
            },
            { status: 409 }
          )
        );
      }

      const updated: PixelRect[] = [
        ...saved,
        {
          id: makeBlockId(),
          ...rectValidation.rect,
          image: imageValidation.image,
          url: url ?? undefined,
          title,
          status: "approved",
          reportCount: 0,
          clickCount: 0,
          ownerClientId: requesterId,
          ownerName,
          ownerAvatar,
          createdAt: new Date().toISOString(),
        },
      ];

      const remainingReservations = activeReservations.filter(
        (reservation) =>
          !(
            reservation.clientId === requesterId &&
            rectanglesOverlap(reservation, rectValidation.rect)
          )
      );

      await writeBlocks(updated);
      await writeReservations(remainingReservations);
      payments[paymentIndex] = { ...payment, consumedAt: new Date(nowMs).toISOString() };
      await writePayments(payments);

      return withNoStoreHeaders(
        NextResponse.json({
          success: true,
          data: updated,
        })
      );
    });
  } catch (error) {
    console.error("POST error:", error);

    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Serwer jest zajety, sprobuj ponownie",
          },
          { status: 503 }
        )
      );
    }

    return withNoStoreHeaders(
      NextResponse.json(
        {
          success: false,
          message: "Blad zapisu",
        },
        { status: 500 }
      )
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const rateError = enforceRateLimit(req, "write");
    if (rateError) return withNoStoreHeaders(rateError);

    const requesterId = getClientId(req);
    const body = (await req.json()) as { id?: unknown; url?: unknown; title?: unknown; ownerName?: unknown; ownerAvatar?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return withNoStoreHeaders(
        NextResponse.json({ success: false, message: "Brak id bloku" }, { status: 400 })
      );
    }

    const url = normalizeOptionalUrl(body.url);
    if (url === null) {
      return withNoStoreHeaders(
        NextResponse.json({ success: false, message: "Nieprawidlowy URL. Uzyj http:// lub https://" }, { status: 400 })
      );
    }
    const title = normalizeOptionalText(body.title, MAX_TITLE_LENGTH);
    const ownerName = normalizeOptionalText(body.ownerName, MAX_OWNER_NAME_LENGTH);
    const ownerAvatar = normalizeOptionalText(body.ownerAvatar, MAX_OWNER_AVATAR_LENGTH);

    return await withFileLock(async () => {
      await ensureStorageFiles();
      const blocks = await readBlocks();
      const idx = blocks.findIndex((block) => block.id === id);
      if (idx === -1) {
        return withNoStoreHeaders(
          NextResponse.json({ success: false, message: "Nie znaleziono bloku" }, { status: 404 })
        );
      }

      const block = blocks[idx];
      if (block.ownerClientId !== requesterId) {
        return withNoStoreHeaders(
          NextResponse.json({ success: false, message: "To nie jest Twoj blok" }, { status: 403 })
        );
      }

      blocks[idx] = {
        ...block,
        url: url ?? undefined,
        title,
        ownerName,
        ownerAvatar,
      };

      await writeBlocks(blocks);
      return withNoStoreHeaders(
        NextResponse.json({ success: true, block: blocks[idx] })
      );
    });
  } catch (error) {
    console.error("PATCH error:", error);
    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(
        NextResponse.json({ success: false, message: "Serwer jest zajety, sprobuj ponownie" }, { status: 503 })
      );
    }
    return withNoStoreHeaders(
      NextResponse.json({ success: false, message: "Blad aktualizacji bloku" }, { status: 500 })
    );
  }
}

export async function PUT(req: Request) {
  try {
    const rateError = enforceRateLimit(req, "write");
    if (rateError) {
      return withNoStoreHeaders(rateError);
    }

    const requesterId = getClientId(req);
    const body = (await req.json()) as {
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    const rectValidation = validateRectangle(body);
    if (!rectValidation.ok) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: rectValidation.message,
          },
          { status: 400 }
        )
      );
    }

    if (rectValidation.rect.width < MIN_PURCHASE_SIZE || rectValidation.rect.height < MIN_PURCHASE_SIZE) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: `Minimalny rozmiar zakupu to ${MIN_PURCHASE_SIZE}x${MIN_PURCHASE_SIZE}`,
          },
          { status: 400 }
        )
      );
    }

    if (rectValidation.rect.width * rectValidation.rect.height > MAX_RESERVED_PIXELS_PER_CLIENT) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Zbyt duzy obszar do rezerwacji",
          },
          { status: 400 }
        )
      );
    }

    return await withFileLock(async () => {
      await ensureStorageFiles();

      const nowMs = Date.now();
      const blocks = await readBlocks();
      const reservations = pruneExpiredReservations(await readReservations(), nowMs);

      const soldConflict = blocks.some((block) => rectanglesOverlap(block, rectValidation.rect));
      if (soldConflict) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Te piksele sa juz zajete",
            },
            { status: 409 }
          )
        );
      }

      const reservedByOther = reservations.some(
        (reservation) =>
          reservation.clientId !== requesterId && rectanglesOverlap(reservation, rectValidation.rect)
      );

      if (reservedByOther) {
        return withNoStoreHeaders(
          NextResponse.json(
            {
              success: false,
              message: "Te piksele sa aktualnie zarezerwowane",
            },
            { status: 409 }
          )
        );
      }

      const expiresAt = new Date(nowMs + RESERVATION_TTL_MS).toISOString();
      const keptReservations = reservations.filter((reservation) => reservation.clientId !== requesterId);
      const reservation: PixelReservation = {
        id: `${requesterId}_${nowMs}`,
        clientId: requesterId,
        ...rectValidation.rect,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt,
      };

      await writeReservations([...keptReservations, reservation]);

      return withNoStoreHeaders(
        NextResponse.json({
          success: true,
          reservation: {
            id: reservation.id,
            x: reservation.x,
            y: reservation.y,
            width: reservation.width,
            height: reservation.height,
            expiresAt: reservation.expiresAt,
          },
        })
      );
    });
  } catch (error) {
    console.error("PUT error:", error);

    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Serwer jest zajety, sprobuj ponownie",
          },
          { status: 503 }
        )
      );
    }

    return withNoStoreHeaders(
      NextResponse.json(
        {
          success: false,
          message: "Blad rezerwacji",
        },
        { status: 500 }
      )
    );
  }
}

export async function DELETE(req: Request) {
  try {
    if (!isValidResetToken(req)) {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Brak autoryzacji do resetu planszy",
          },
          { status: 403 }
        )
      );
    }

    const rateError = enforceRateLimit(req, "write");
    if (rateError) {
      return withNoStoreHeaders(rateError);
    }

    return await withFileLock(async () => {
      await ensureStorageFiles();
      await writeBlocks([]);
      await writeReservations([]);
      await writePayments([]);

      return withNoStoreHeaders(
        NextResponse.json({
          success: true,
          data: [],
        })
      );
    });
  } catch (error) {
    console.error("DELETE error:", error);

    if ((error as Error).message === "LOCK_TIMEOUT") {
      return withNoStoreHeaders(
        NextResponse.json(
          {
            success: false,
            message: "Serwer jest zajety, sprobuj ponownie",
          },
          { status: 503 }
        )
      );
    }

    return withNoStoreHeaders(
      NextResponse.json(
        {
          success: false,
          message: "Blad kasowania",
        },
        { status: 500 }
      )
    );
  }
}
