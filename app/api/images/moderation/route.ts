import { NextResponse } from "next/server";
import { moderateImageDataUrl } from "../../_shared/imageModeration";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { image?: unknown };
    const image = typeof body.image === "string" ? body.image : "";

    if (!image.startsWith("data:image/") || !image.includes(";base64,")) {
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          message: "Nieprawidlowy obraz",
        },
        { status: 400 }
      );
    }

    const moderation = await moderateImageDataUrl(image);
    if (!moderation.allowed) {
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          message: moderation.reason || "Obraz nie przeszedl automatycznej moderacji.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      allowed: true,
      flagged: moderation.flagged ?? false,
      mode: moderation.mode,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        allowed: false,
        message: "Blad walidacji obrazu",
      },
      { status: 500 }
    );
  }
}
