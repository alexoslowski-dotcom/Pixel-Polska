import { createHash, randomUUID } from "crypto";

export const CLIENT_ID_COOKIE_NAME = "pp_client_id";

const CLIENT_ID_PATTERN = /^cid_[a-z0-9]{24,64}$/;

function isValidClientId(value: string | null | undefined): value is string {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value);
}

function parseCookies(cookieHeader: string | null) {
  if (!cookieHeader) return new Map<string, string>();
  const out = new Map<string, string>();
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (!rawKey) continue;
    out.set(rawKey, decodeURIComponent(rawValueParts.join("=") || ""));
  }
  return out;
}

function getCookieClientId(req: Request) {
  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const candidate = cookies.get(CLIENT_ID_COOKIE_NAME);
  return isValidClientId(candidate) ? candidate : null;
}

function hashText(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function getFallbackClientId(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const userAgent = req.headers.get("user-agent")?.trim() ?? "";
  const basis = `${forwardedFor}|${userAgent}`;
  return `cid_${hashText(basis || "unknown").slice(0, 32)}`;
}

export function makeClientId() {
  return `cid_${randomUUID().replace(/-/g, "").slice(0, 32)}`;
}

export function resolveClientId(req: Request) {
  const internalHeader = req.headers.get("x-internal-client-id")?.trim();
  if (isValidClientId(internalHeader)) return internalHeader;

  const cookieId = getCookieClientId(req);
  if (cookieId) return cookieId;

  return getFallbackClientId(req);
}

