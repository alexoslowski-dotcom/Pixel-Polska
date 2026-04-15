type ModerationMode = "off" | "report-only" | "enforce";

type OpenAIModerationResponse = {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
  }>;
  error?: {
    message?: string;
  };
};

const OPENAI_MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL?.trim() || "omni-moderation-latest";
const OPENAI_MODERATION_TIMEOUT_MS = 12_000;

function getModerationMode(): ModerationMode {
  const raw = process.env.IMAGE_MODERATION_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "report-only" || raw === "enforce") return raw;
  return "enforce";
}

export type ImageModerationResult = {
  allowed: boolean;
  mode: ModerationMode;
  reason?: string;
  flagged?: boolean;
};

export async function moderateImageDataUrl(imageDataUrl: string): Promise<ImageModerationResult> {
  const mode = getModerationMode();
  if (mode === "off") {
    return { allowed: true, mode, flagged: false };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (mode === "enforce") {
      return {
        allowed: false,
        mode,
        reason: "Brak konfiguracji moderacji obrazow (OPENAI_API_KEY).",
      };
    }
    return { allowed: true, mode, flagged: false, reason: "Brak OPENAI_API_KEY - moderacja dziala w trybie report-only." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_MODERATION_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODERATION_MODEL,
        input: [
          {
            type: "input_image",
            image_url: imageDataUrl,
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = (await res.json()) as OpenAIModerationResponse;
    if (!res.ok) {
      const errorMessage = payload?.error?.message || `Moderation API error (${res.status})`;
      if (mode === "enforce") {
        return { allowed: false, mode, reason: `Blad moderacji: ${errorMessage}` };
      }
      return { allowed: true, mode, flagged: false, reason: errorMessage };
    }

    const firstResult = Array.isArray(payload.results) ? payload.results[0] : undefined;
    const flaggedByCategory = !!firstResult?.categories && Object.values(firstResult.categories).some(Boolean);
    const flagged = Boolean(firstResult?.flagged || flaggedByCategory);

    if (flagged && mode === "enforce") {
      return {
        allowed: false,
        mode,
        flagged: true,
        reason: "Obraz narusza zasady tresci (NSFW / niedozwolone tresci).",
      };
    }

    return {
      allowed: true,
      mode,
      flagged,
      reason: flagged ? "Obraz oznaczony przez moderacje, ale tryb nie blokuje zapisu." : undefined,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Nieznany blad moderacji";
    if (mode === "enforce") {
      return { allowed: false, mode, reason: `Nie mozna zweryfikowac obrazu: ${reason}` };
    }
    return { allowed: true, mode, flagged: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}
