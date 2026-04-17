import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CLIENT_ID_COOKIE_NAME = "pp_client_id";
const CLIENT_ID_PATTERN = /^cid_[a-z0-9]{24,64}$/;

function getValidClientId(req: NextRequest) {
  const fromCookie = req.cookies.get(CLIENT_ID_COOKIE_NAME)?.value;
  if (fromCookie && CLIENT_ID_PATTERN.test(fromCookie)) return fromCookie;

  const fromHeader = req.headers.get("x-internal-client-id")?.trim();
  if (fromHeader && CLIENT_ID_PATTERN.test(fromHeader)) return fromHeader;

  return null;
}

export function proxy(req: NextRequest) {
  const existingClientId = getValidClientId(req);
  const clientId = existingClientId ?? `cid_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-internal-client-id", clientId);
  requestHeaders.delete("x-client-id");

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (!existingClientId) {
    res.cookies.set(CLIENT_ID_COOKIE_NAME, clientId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};

