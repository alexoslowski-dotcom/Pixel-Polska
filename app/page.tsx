
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PixelBlock = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image: string;
  url?: string;
  title?: string;
  ownerName?: string;
  ownerAvatar?: string;
  createdAt?: string;
  clickCount?: number;
};

type PixelReservation = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expiresAt: string;
  ownedByRequester?: boolean;
};

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SaveResponse = {
  success?: boolean;
  message?: string;
};

type ReserveResponse = {
  success?: boolean;
  message?: string;
};

type PaymentCheckoutResponse = {
  success?: boolean;
  message?: string;
  paymentId?: string;
  checkoutUrl?: string;
};

type PaymentStatusResponse = {
  success?: boolean;
  message?: string;
  status?: "pending" | "paid" | "failed" | "expired";
  amount?: number;
  rect?: SelectionRect;
};

type PixelsResponse = {
  blocks?: PixelBlock[];
  myBlocks?: PixelBlock[];
  reservations?: PixelReservation[];
  activeViewers?: number;
};

type TopRankItem = {
  id: string;
  clicks: number;
  image: string;
  title?: string;
  url?: string;
};

type TopAnalyticsResponse = {
  success?: boolean;
  top24h?: TopRankItem[];
  top7d?: TopRankItem[];
};

type PaymentHistoryItem = {
  id: string;
  amount: number;
  status: "pending" | "paid" | "failed" | "expired";
  createdAt: string;
  paidAt?: string;
  invoiceNo: string;
  rect: SelectionRect;
};

type PaymentHistoryResponse = {
  success?: boolean;
  message?: string;
  items?: PaymentHistoryItem[];
};

type CelebrationState = {
  visible: boolean;
  message: string;
  shareUrl: string;
};

type HoverPreview = {
  id?: string;
  title: string;
  url?: string;
  ownerName?: string;
  ownerAvatar?: string;
  rect: SelectionRect;
};

type CheckoutDraft = {
  rect: SelectionRect;
  image: string;
  fileName: string;
  targetUrl: string;
  adTitle: string;
  ownerName: string;
  ownerAvatar: string;
  previewConfirmed: boolean;
};

const GRID_COLUMNS = 1000;
const GRID_ROWS = 1000;
const MIN_SELECTION_SIZE = 10;
const SELECTION_STEP = 10;
const VISUAL_GRID_STEP = 10;
const DEFAULT_FIND_WIDTH = 50;
const DEFAULT_FIND_HEIGHT = 50;
const CLIENT_ID_KEY = "pixel_client_id";
const REF_SOURCE_KEY = "pixel_ref_source";
const CHECKOUT_DRAFT_KEY = "pixel_checkout_draft";
const MAX_IMAGE_CHARS_CLIENT = 1_450_000;


export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const clientIdRef = useRef<string>("");
  const autoSavedPaymentIdRef = useRef<string | null>(null);
  const payInFlightRef = useRef(false);
  const checkoutFlowInFlightRef = useRef(false);

  const [isPointerDown, setIsPointerDown] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selectedRect, setSelectedRect] = useState<SelectionRect | null>(null);
  const [blocks, setBlocks] = useState<PixelBlock[]>([]);
  const [myBlocks, setMyBlocks] = useState<PixelBlock[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);
  const [reservations, setReservations] = useState<PixelReservation[]>([]);
  const [step, setStep] = useState<"select" | "upload" | "checkout">("select");
  const [image, setImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState("Nie wybrano pliku");
  const [isOptimizingImage, setIsOptimizingImage] = useState(false);
  const [isModeratingImage, setIsModeratingImage] = useState(false);
  const [isCheckoutStarting, setIsCheckoutStarting] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [adTitle, setAdTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerAvatar, setOwnerAvatar] = useState("🔥");
  const [selectionError, setSelectionError] = useState("");
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [, setIsPaying] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [paidRect, setPaidRect] = useState<SelectionRect | null>(null);
  const [, setIsSaving] = useState(false);
  const [isReserving, setIsReserving] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [activeViewers, setActiveViewers] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [previousSelection, setPreviousSelection] = useState<SelectionRect | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [top24h, setTop24h] = useState<TopRankItem[]>([]);
  const [top7d, setTop7d] = useState<TopRankItem[]>([]);
  const [referralClaims, setReferralClaims] = useState(0);
  const [hydratedReferralCode, setHydratedReferralCode] = useState("PIXEL001");
  const [refCopied, setRefCopied] = useState(false);
  const [isReferralOpen, setIsReferralOpen] = useState(true);
  const [isMyBlocksOpen, setIsMyBlocksOpen] = useState(true);
  const [checkoutReturnState, setCheckoutReturnState] = useState<"success" | "cancel" | null>(null);
  const [celebration, setCelebration] = useState<CelebrationState>({
    visible: false,
    message: "",
    shareUrl: "",
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Pixel Polska",
        url: "https://pixelpolska.pl",
        logo: "https://pixelpolska.pl/og-pixel.svg",
        sameAs: ["https://instagram.com/pixelpolska"],
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: "kontakt@pixelpolska.pl",
            areaServed: "PL",
            availableLanguage: "pl",
          },
        ],
      },
      {
        "@type": "WebSite",
        name: "Pixel Polska",
        url: "https://pixelpolska.pl",
        inLanguage: "pl-PL",
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Jak dziala zakup pixeli?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Wybierasz obszar, dodajesz obrazek i link, oplacasz zamowienie i Twoj blok trafia na plansze.",
            },
          },
          {
            "@type": "Question",
            name: "Czy moge edytowac link po zakupie?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Tak, w sekcji Moje bloki mozesz aktualizowac tytul i URL swojego bloku.",
            },
          },
        ],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Start", item: "https://pixelpolska.pl/" },
          { "@type": "ListItem", position: 2, name: "Kup pixel", item: "https://pixelpolska.pl/#kup-pixel" },
        ],
      },
    ],
  };

  const getClientId = useCallback(() => {
    if (clientIdRef.current) return clientIdRef.current;

    const fallback = `client_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    if (typeof window === "undefined") {
      clientIdRef.current = fallback;
      return fallback;
    }

    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{6,80}$/.test(existing)) {
      clientIdRef.current = existing;
      return existing;
    }

    const next = `client_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : fallback}`;
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    clientIdRef.current = next;
    return next;
  }, []);

  const getReferralCode = useCallback(() => {
    const clientId = getClientId();
    const cleaned = clientId.replace(/^client_/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return cleaned.slice(0, 8) || "PIXEL001";
  }, [getClientId]);

  const rectanglesOverlap = (a: SelectionRect, b: SelectionRect) => {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  };

  const isElement = (value: EventTarget | null): value is Element => value instanceof Element;

  const fetchPixels = useCallback(async () => {
    try {
      const query =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/pixels?mine=1`
          : "/api/pixels?mine=1";
      const res = await fetch(query, {
        cache: "no-store",
        headers: { "x-client-id": getClientId() },
      });

      if (!res.ok) {
        setBlocks([]);
        setMyBlocks([]);
        setReservations([]);
        return;
      }

      const payload = (await res.json()) as PixelsResponse | unknown;
      if (!payload || typeof payload !== "object") {
        setBlocks([]);
        setMyBlocks([]);
        setReservations([]);
        return;
      }

      const maybeBlocks = (payload as PixelsResponse).blocks;
      const maybeMyBlocks = (payload as PixelsResponse).myBlocks;
      const maybeReservations = (payload as PixelsResponse).reservations;
      const maybeActiveViewers = (payload as PixelsResponse).activeViewers;

      const normalizedBlocks = Array.isArray(maybeBlocks)
        ? maybeBlocks.flatMap((block): PixelBlock[] => {
            if (!block || typeof block !== "object") return [];
            const x = (block as { x?: unknown }).x;
            const y = (block as { y?: unknown }).y;
            const width = (block as { width?: unknown }).width;
            const height = (block as { height?: unknown }).height;
            const id = (block as { id?: unknown }).id;
            const image = (block as { image?: unknown }).image;
            const url = (block as { url?: unknown }).url;
            const title = (block as { title?: unknown }).title;
            const ownerName = (block as { ownerName?: unknown }).ownerName;
            const ownerAvatar = (block as { ownerAvatar?: unknown }).ownerAvatar;
            const createdAt = (block as { createdAt?: unknown }).createdAt;
            const clickCount = (block as { clickCount?: unknown }).clickCount;

            if (
              typeof id !== "string" ||
              !Number.isInteger(x) ||
              !Number.isInteger(y) ||
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              typeof image !== "string"
            ) {
              return [];
            }

            const xNum = x as number;
            const yNum = y as number;
            const widthNum = width as number;
            const heightNum = height as number;

            if (xNum < 0 || yNum < 0 || widthNum <= 0 || heightNum <= 0) return [];
            if (xNum + widthNum > GRID_COLUMNS || yNum + heightNum > GRID_ROWS) return [];

            return [{
              id,
              x: xNum,
              y: yNum,
              width: widthNum,
              height: heightNum,
              image,
              url: typeof url === "string" ? url : undefined,
              title: typeof title === "string" ? title : undefined,
              ownerName: typeof ownerName === "string" ? ownerName : undefined,
              ownerAvatar: typeof ownerAvatar === "string" ? ownerAvatar : undefined,
              createdAt: typeof createdAt === "string" ? createdAt : undefined,
              clickCount: Number.isInteger(clickCount) ? Number(clickCount) : 0,
            }];
          })
        : [];

      const normalizedMyBlocks = Array.isArray(maybeMyBlocks)
        ? maybeMyBlocks.flatMap((block): PixelBlock[] => {
            if (!block || typeof block !== "object") return [];
            const x = (block as { x?: unknown }).x;
            const y = (block as { y?: unknown }).y;
            const width = (block as { width?: unknown }).width;
            const height = (block as { height?: unknown }).height;
            const id = (block as { id?: unknown }).id;
            const image = (block as { image?: unknown }).image;
            const url = (block as { url?: unknown }).url;
            const title = (block as { title?: unknown }).title;
            const ownerName = (block as { ownerName?: unknown }).ownerName;
            const ownerAvatar = (block as { ownerAvatar?: unknown }).ownerAvatar;
            const createdAt = (block as { createdAt?: unknown }).createdAt;
            const clickCount = (block as { clickCount?: unknown }).clickCount;

            if (
              typeof id !== "string" ||
              !Number.isInteger(x) ||
              !Number.isInteger(y) ||
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              typeof image !== "string"
            ) {
              return [];
            }

            return [{
              id,
              x: x as number,
              y: y as number,
              width: width as number,
              height: height as number,
              image,
              url: typeof url === "string" ? url : undefined,
              title: typeof title === "string" ? title : undefined,
              ownerName: typeof ownerName === "string" ? ownerName : undefined,
              ownerAvatar: typeof ownerAvatar === "string" ? ownerAvatar : undefined,
              createdAt: typeof createdAt === "string" ? createdAt : undefined,
              clickCount: Number.isInteger(clickCount) ? Number(clickCount) : 0,
            }];
          })
        : [];

      const normalizedReservations = Array.isArray(maybeReservations)
        ? maybeReservations.flatMap((reservation): PixelReservation[] => {
            if (!reservation || typeof reservation !== "object") return [];

            const id = (reservation as { id?: unknown }).id;
            const x = (reservation as { x?: unknown }).x;
            const y = (reservation as { y?: unknown }).y;
            const width = (reservation as { width?: unknown }).width;
            const height = (reservation as { height?: unknown }).height;
            const expiresAt = (reservation as { expiresAt?: unknown }).expiresAt;
            const ownedByRequester = (reservation as { ownedByRequester?: unknown }).ownedByRequester;

            if (
              typeof id !== "string" ||
              !Number.isInteger(x) ||
              !Number.isInteger(y) ||
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              typeof expiresAt !== "string"
            ) {
              return [];
            }

            const xNum = x as number;
            const yNum = y as number;
            const widthNum = width as number;
            const heightNum = height as number;

            if (xNum < 0 || yNum < 0 || widthNum <= 0 || heightNum <= 0) return [];
            if (xNum + widthNum > GRID_COLUMNS || yNum + heightNum > GRID_ROWS) return [];
            if (Number.isNaN(Date.parse(expiresAt))) return [];

            return [{
              id,
              x: xNum,
              y: yNum,
              width: widthNum,
              height: heightNum,
              expiresAt,
              ownedByRequester: Boolean(ownedByRequester),
            }];
          })
        : [];

      setBlocks(normalizedBlocks);
      setMyBlocks(normalizedMyBlocks);
      setReservations(normalizedReservations);
      setActiveViewers(Number.isInteger(maybeActiveViewers) ? Math.max(1, Number(maybeActiveViewers)) : 1);
    } catch {
      setBlocks([]);
      setMyBlocks([]);
      setReservations([]);
      setActiveViewers(1);
    }
  }, [getClientId]);

  const fetchPaymentHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/payments/history", {
        cache: "no-store",
        headers: { "x-client-id": getClientId() },
      });
      if (!res.ok) {
        setPaymentHistory([]);
        return;
      }

      const payload = (await res.json()) as PaymentHistoryResponse | unknown;
      if (!payload || typeof payload !== "object") {
        setPaymentHistory([]);
        return;
      }

      const maybeItems = (payload as PaymentHistoryResponse).items;
      const normalized = Array.isArray(maybeItems)
        ? maybeItems.flatMap((item): PaymentHistoryItem[] => {
            if (!item || typeof item !== "object") return [];
            const id = (item as { id?: unknown }).id;
            const amount = (item as { amount?: unknown }).amount;
            const status = (item as { status?: unknown }).status;
            const createdAt = (item as { createdAt?: unknown }).createdAt;
            const paidAt = (item as { paidAt?: unknown }).paidAt;
            const invoiceNo = (item as { invoiceNo?: unknown }).invoiceNo;
            const rect = (item as { rect?: unknown }).rect;

            if (
              typeof id !== "string" ||
              !Number.isInteger(amount) ||
              typeof status !== "string" ||
              typeof createdAt !== "string" ||
              typeof invoiceNo !== "string" ||
              !rect ||
              typeof rect !== "object"
            ) {
              return [];
            }

            const x = (rect as { x?: unknown }).x;
            const y = (rect as { y?: unknown }).y;
            const width = (rect as { width?: unknown }).width;
            const height = (rect as { height?: unknown }).height;
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
              return [];
            }

            if (!["pending", "paid", "failed", "expired"].includes(status)) return [];

            return [{
              id,
              amount: amount as number,
              status: status as PaymentHistoryItem["status"],
              createdAt,
              paidAt: typeof paidAt === "string" ? paidAt : undefined,
              invoiceNo,
              rect: {
                x: x as number,
                y: y as number,
                width: width as number,
                height: height as number,
              },
            }];
          })
        : [];

      setPaymentHistory(normalized);
    } catch {
      setPaymentHistory([]);
    }
  }, [getClientId]);

  const fetchTopAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/top", { cache: "no-store" });
      if (!res.ok) {
        setTop24h([]);
        setTop7d([]);
        return;
      }
      const payload = (await res.json()) as TopAnalyticsResponse;
      const normalize = (items?: TopRankItem[]) =>
        Array.isArray(items)
          ? items.filter((item) => item && typeof item.id === "string" && Number.isInteger(item.clicks) && typeof item.image === "string")
          : [];
      setTop24h(normalize(payload.top24h));
      setTop7d(normalize(payload.top7d));
    } catch {
      setTop24h([]);
      setTop7d([]);
    }
  }, []);

  const fetchReferralStats = useCallback(async () => {
    const code = getReferralCode();
    try {
      const res = await fetch(`/api/referrals?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!res.ok) {
        setReferralClaims(0);
        return;
      }
      const payload = (await res.json()) as { claims?: unknown };
      setReferralClaims(Number.isInteger(payload.claims) ? Number(payload.claims) : 0);
    } catch {
      setReferralClaims(0);
    }
  }, [getReferralCode]);

  useEffect(() => { void fetchPixels(); }, [fetchPixels]);
  useEffect(() => { void fetchPaymentHistory(); }, [fetchPaymentHistory]);
  useEffect(() => { void fetchTopAnalytics(); }, [fetchTopAnalytics]);
  useEffect(() => { void fetchReferralStats(); }, [fetchReferralStats]);
  useEffect(() => {
    setHydratedReferralCode(getReferralCode());
  }, [getReferralCode]);
  useEffect(() => {
    if (!refCopied) return;
    const timer = window.setTimeout(() => setRefCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [refCopied]);
  useEffect(() => {
    const poll = window.setInterval(() => void fetchPixels(), 5000);
    return () => window.clearInterval(poll);
  }, [fetchPixels]);
  useEffect(() => {
    const poll = window.setInterval(() => void fetchPaymentHistory(), 12_000);
    return () => window.clearInterval(poll);
  }, [fetchPaymentHistory]);
  useEffect(() => {
    const poll = window.setInterval(() => void fetchTopAnalytics(), 10_000);
    return () => window.clearInterval(poll);
  }, [fetchTopAnalytics]);
  useEffect(() => {
    const poll = window.setInterval(() => void fetchReferralStats(), 15_000);
    return () => window.clearInterval(poll);
  }, [fetchReferralStats]);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refCode = new URLSearchParams(window.location.search).get("ref");
    if (!refCode) return;
    const normalized = refCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(normalized)) return;
    if (normalized === getReferralCode()) return;
    window.localStorage.setItem(REF_SOURCE_KEY, normalized);
  }, [getReferralCode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paymentFromUrl = params.get("paymentId")?.trim();
    const checkoutState = params.get("checkout")?.trim();
    if (!paymentFromUrl) return;

    const draftRaw = window.localStorage.getItem(CHECKOUT_DRAFT_KEY);
    if (draftRaw) {
      try {
        const parsed = JSON.parse(draftRaw) as Partial<CheckoutDraft>;
        const rect = parsed.rect;
        const isRectValid =
          !!rect &&
          Number.isInteger(rect.x) &&
          Number.isInteger(rect.y) &&
          Number.isInteger(rect.width) &&
          Number.isInteger(rect.height) &&
          rect.width > 0 &&
          rect.height > 0;
        if (isRectValid) {
          setSelectedRect(rect);
          setPaidRect(rect);
        }
        if (typeof parsed.image === "string" && parsed.image.startsWith("data:image/")) {
          setImage(parsed.image);
        }
        if (typeof parsed.fileName === "string" && parsed.fileName.trim()) {
          setFileName(parsed.fileName);
        }
        if (typeof parsed.targetUrl === "string") setTargetUrl(parsed.targetUrl);
        if (typeof parsed.adTitle === "string") setAdTitle(parsed.adTitle);
        if (typeof parsed.ownerName === "string") setOwnerName(parsed.ownerName);
        if (typeof parsed.ownerAvatar === "string") setOwnerAvatar(parsed.ownerAvatar);
        if (typeof parsed.previewConfirmed === "boolean") setPreviewConfirmed(parsed.previewConfirmed);
      } catch {}
    }

    setPaymentId(paymentFromUrl);
    setStep("checkout");
    if (checkoutState === "success" || checkoutState === "cancel") {
      setCheckoutReturnState(checkoutState);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("paymentId");
      nextUrl.searchParams.delete("checkout");
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }
  }, []);
  useEffect(() => {
    setPreviewConfirmed(false);
  }, [selectedRect?.x, selectedRect?.y, selectedRect?.width, selectedRect?.height]);
  useEffect(() => {
    if (!celebration.visible) return;
    const timer = window.setTimeout(() => setCelebration((prev) => ({ ...prev, visible: false })), 3500);
    return () => window.clearTimeout(timer);
  }, [celebration.visible]);
  useEffect(() => {
    if (!paymentId || isPaid) return;

    let isCancelled = false;
    let attempts = 0;
    const maxAttempts = 30;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/payments?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
          headers: { "x-client-id": getClientId() },
        });
        const payload = (await res.json()) as PaymentStatusResponse;
        if (isCancelled || !res.ok || !payload.success || !payload.status) return;

        if (payload.rect && !selectedRect) {
          setSelectedRect(payload.rect);
          setStep("checkout");
        }

        if (payload.status === "paid") {
          setIsPaid(true);
          if (payload.rect) {
            setPaidRect({ ...payload.rect });
          } else if (selectedRect) {
            setPaidRect({ ...selectedRect });
          }
          return;
        }

        if (payload.status === "expired" || payload.status === "failed") {
          setIsPaid(false);
          setPaymentId(null);
          setPaidRect(null);
          if (typeof window !== "undefined") window.localStorage.removeItem(CHECKOUT_DRAFT_KEY);
          alert(payload.status === "expired" ? "Platnosc wygasla. Sprobuj ponownie." : "Platnosc nie powiodla sie.");
          return;
        }
      } catch {}
    };

    void checkStatus();
    const interval = window.setInterval(() => {
      attempts += 1;
      if (attempts > maxAttempts) {
        window.clearInterval(interval);
        return;
      }
      void checkStatus();
    }, 3000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [getClientId, isPaid, paymentId, selectedRect]);

  const soldPixels = useMemo(() => blocks.reduce((sum, block) => sum + block.width * block.height, 0), [blocks]);
  const soldPercent = Math.min(100, Math.max(0, (soldPixels / (GRID_COLUMNS * GRID_ROWS)) * 100));
  const selectedPixelsCountRaw = selectedRect ? selectedRect.width * selectedRect.height : 0;
  const selectedPixelsCount = Math.min(selectedPixelsCountRaw, GRID_COLUMNS * GRID_ROWS);
  const totalPrice = selectedPixelsCount;
  const dragSizeLabel = selectedRect ? `${selectedRect.width}x${selectedRect.height}` : "-";

  const activeOtherReservations = useMemo(
    () => reservations.filter((reservation) => !reservation.ownedByRequester && Date.parse(reservation.expiresAt) > nowMs),
    [nowMs, reservations]
  );

  const activeOwnReservation = useMemo(
    () => reservations.find((reservation) => reservation.ownedByRequester && Date.parse(reservation.expiresAt) > nowMs) ?? null,
    [nowMs, reservations]
  );

  const reservationSecondsLeft = activeOwnReservation ? Math.max(0, Math.ceil((Date.parse(activeOwnReservation.expiresAt) - nowMs) / 1000)) : 0;
  const reservationLabel = reservationSecondsLeft > 0 ? `${Math.floor(reservationSecondsLeft / 60)}:${String(reservationSecondsLeft % 60).padStart(2, "0")}` : "-";

  const getBlockDisplayTitle = (block: Pick<PixelBlock, "title" | "url">) => {
    const trimmed = block.title?.trim();
    if (trimmed) return trimmed;
    if (block.url) {
      try {
        return new URL(block.url).hostname.replace(/^www\./, "");
      } catch {
        return block.url;
      }
    }
    return "Kupiony blok";
  };

  const focusBlockOnBoard = (block: Pick<PixelBlock, "x" | "y" | "width" | "height" | "title" | "url" | "ownerName" | "ownerAvatar">) => {
    if (zoomLevel < 1.5) setZoomLevel(1.5);

    setHoverPreview({
      title: getBlockDisplayTitle(block),
      url: block.url,
      ownerName: block.ownerName,
      ownerAvatar: block.ownerAvatar,
      rect: { x: block.x, y: block.y, width: block.width, height: block.height },
    });

    window.setTimeout(() => {
      if (!viewportRef.current) return;
      const viewport = viewportRef.current;
      const scrollWidth = viewport.scrollWidth;
      const targetCenterX = ((block.x + block.width / 2) / GRID_COLUMNS) * scrollWidth;
      const nextLeft = Math.max(0, targetCenterX - viewport.clientWidth / 2);
      viewport.scrollTo({ left: nextLeft, behavior: "smooth" });
    }, zoomLevel < 1.5 ? 80 : 0);
  };

  const recentPurchases = useMemo(() => {
    const sorted = [...blocks].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
    return sorted.slice(0, 6);
  }, [blocks]);

  const latestPurchaseLabel = useMemo(() => {
    if (recentPurchases.length === 0) return "brak nowych zakupow";
    const createdAt = recentPurchases[0].createdAt;
    if (!createdAt) return "przed chwila";
    const diff = Math.max(1, Math.floor((nowMs - Date.parse(createdAt)) / 1000));
    if (diff < 60) return `${diff}s temu`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m temu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h temu`;
    return `${Math.floor(diff / 86400)}d temu`;
  }, [recentPurchases, nowMs]);

  const searchNormalized = searchQuery.trim().toLowerCase();
  const hasSearchQuery = searchNormalized.length >= 2;
  const searchedBlocks = useMemo(() => {
    if (!hasSearchQuery) return [];
    return blocks
      .filter((block) =>
        [
          block.title ?? "",
          block.url ?? "",
          block.ownerName ?? "",
        ].join(" ").toLowerCase().includes(searchNormalized)
      )
      .slice(0, 8);
  }, [blocks, hasSearchQuery, searchNormalized]);

  const searchedIds = useMemo(() => new Set(searchedBlocks.map((block) => block.id)), [searchedBlocks]);

  const selectionConflicts = (rect: SelectionRect) => {
    if (blocks.some((block) => rectanglesOverlap(rect, block))) return true;
    return activeOtherReservations.some((reservation) => rectanglesOverlap(rect, reservation));
  };

  const selectionTooSmall = (rect: SelectionRect) =>
    rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE;

  const selectedHasTaken = selectedRect ? selectionConflicts(selectedRect) : false;
  const selectedTooSmall = selectedRect ? selectionTooSmall(selectedRect) : false;

  const occupiedPrefix = useMemo(() => {
    const occupied = new Uint8Array(GRID_COLUMNS * GRID_ROWS);

    const mark = (rect: SelectionRect) => {
      const xStart = Math.max(0, rect.x);
      const yStart = Math.max(0, rect.y);
      const xEnd = Math.min(GRID_COLUMNS, rect.x + rect.width);
      const yEnd = Math.min(GRID_ROWS, rect.y + rect.height);
      for (let y = yStart; y < yEnd; y++) {
        const rowOffset = y * GRID_COLUMNS;
        for (let x = xStart; x < xEnd; x++) occupied[rowOffset + x] = 1;
      }
    };

    blocks.forEach(mark);
    activeOtherReservations.forEach(mark);

    const stride = GRID_COLUMNS + 1;
    const prefix = new Int32Array((GRID_COLUMNS + 1) * (GRID_ROWS + 1));
    for (let y = 1; y <= GRID_ROWS; y++) {
      let rowSum = 0;
      for (let x = 1; x <= GRID_COLUMNS; x++) {
        rowSum += occupied[(y - 1) * GRID_COLUMNS + (x - 1)];
        prefix[y * stride + x] = prefix[(y - 1) * stride + x] + rowSum;
      }
    }
    return prefix;
  }, [blocks, activeOtherReservations]);

  const sumRect = (prefix: Int32Array, x: number, y: number, width: number, height: number) => {
    const stride = GRID_COLUMNS + 1;
    const x2 = x + width;
    const y2 = y + height;
    return prefix[y2 * stride + x2] - prefix[y * stride + x2] - prefix[y2 * stride + x] + prefix[y * stride + x];
  };

  const findFirstFreeRect = (width: number, height: number) => {
    if (width <= 0 || height <= 0 || width > GRID_COLUMNS || height > GRID_ROWS) return null;
    const maxX = GRID_COLUMNS - width;
    const maxY = GRID_ROWS - height;
    for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x <= maxX; x++) {
        if (sumRect(occupiedPrefix, x, y, width, height) === 0) return { x, y, width, height };
      }
    }
    return null;
  };

  const handleFindFreeSpot = () => {
    const targetWidth = Math.max(1, Math.min(GRID_COLUMNS, selectedRect?.width ?? DEFAULT_FIND_WIDTH));
    const targetHeight = Math.max(1, Math.min(GRID_ROWS, selectedRect?.height ?? DEFAULT_FIND_HEIGHT));
    const found = findFirstFreeRect(targetWidth, targetHeight);
    if (!found) return alert(`Brak wolnego miejsca ${targetWidth}x${targetHeight}`);
    setSelectedRect(found);
    setSelectionError("");
    setStep("select");
  };

  const handlePackSelect = (width: number, height: number) => {
    const found = findFirstFreeRect(width, height);
    if (!found) return alert(`Brak wolnego miejsca ${width}x${height}`);
    if (selectedRect) setPreviousSelection(selectedRect);
    setSelectedRect(found);
    setSelectionError("");
    setStep("select");
  };

  const recommendedSpots = (() => {
    const packs = [
      { width: 20, height: 20 },
      { width: 40, height: 40 },
      { width: 80, height: 40 },
    ];
    return packs.flatMap((pack) => {
      const found = findFirstFreeRect(pack.width, pack.height);
      if (!found) return [];
      return [{
        label: `${pack.width}x${pack.height}`,
        rect: found,
      }];
    });
  })();

  const snapSelectionToNearestPack = () => {
    if (!selectedRect) return;
    const packs: Array<{ width: number; height: number }> = [
      { width: 10, height: 10 },
      { width: 25, height: 25 },
      { width: 50, height: 50 },
      { width: 100, height: 100 },
    ];

    let best = packs[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pack of packs) {
      const distance = Math.abs(pack.width - selectedRect.width) + Math.abs(pack.height - selectedRect.height);
      if (distance < bestDistance) {
        best = pack;
        bestDistance = distance;
      }
    }

    const maxX = GRID_COLUMNS - best.width;
    const maxY = GRID_ROWS - best.height;
    setPreviousSelection(selectedRect);
    setSelectedRect({
      x: Math.max(0, Math.min(maxX, selectedRect.x)),
      y: Math.max(0, Math.min(maxY, selectedRect.y)),
      width: best.width,
      height: best.height,
    });
  };

  const clearSelection = () => {
    if (!selectedRect) return;
    setPreviousSelection(selectedRect);
    setSelectedRect(null);
    setSelectionError("");
  };

  const restorePreviousSelection = () => {
    if (!previousSelection) return;
    setSelectedRect(previousSelection);
    setSelectionError("");
  };

  const getGridPointFromPointer = (clientX: number, clientY: number) => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const relativeX = (clientX - rect.left) / rect.width;
    const relativeY = (clientY - rect.top) / rect.height;
    const clampedX = Math.min(0.999999, Math.max(0, relativeX));
    const clampedY = Math.min(0.999999, Math.max(0, relativeY));
    const rawX = Math.floor(clampedX * GRID_COLUMNS);
    const rawY = Math.floor(clampedY * GRID_ROWS);
    const snappedX = Math.min(GRID_COLUMNS - SELECTION_STEP, Math.floor(rawX / SELECTION_STEP) * SELECTION_STEP);
    const snappedY = Math.min(GRID_ROWS - SELECTION_STEP, Math.floor(rawY / SELECTION_STEP) * SELECTION_STEP);
    return { x: snappedX, y: snappedY };
  };

  const buildRectFromPoints = (a: { x: number; y: number }, b: { x: number; y: number }): SelectionRect => {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return { x: minX, y: minY, width: maxX - minX + SELECTION_STEP, height: maxY - minY + SELECTION_STEP };
  };

  const reserveSelection = async (rect: SelectionRect) => {
    setIsReserving(true);
    try {
      const res = await fetch("/api/pixels", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-client-id": getClientId() },
        body: JSON.stringify(rect),
      });
      const data = (await res.json()) as ReserveResponse;
      if (!res.ok || !data.success) {
        alert(data.message || "Nie mozna zarezerwowac obszaru");
        await fetchPixels();
        return false;
      }
      await fetchPixels();
      return true;
    } catch {
      alert("Blad polaczenia z serwerem");
      return false;
    } finally {
      setIsReserving(false);
    }
  };

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return;
    if (event.altKey || isPanning) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a")) return;
    const point = getGridPointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    if (selectedRect) setPreviousSelection(selectedRect);

    if (step === "checkout" && (isPaid || paymentId)) {
      const shouldResetPayment = window.confirm("Masz aktywna platnosc dla obecnego obszaru. Zmienic wybor i zresetowac platnosc?");
      if (!shouldResetPayment) return;
    }

    setIsPointerDown(true);
    setDragStart({ x: point.x, y: point.y });
    setSelectedRect(buildRectFromPoints(point, point));
    setSelectionError("");
    if (step !== "select") setStep("select");
    setIsPaid(false);
    setPaymentId(null);
    setPaidRect(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBoardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) return;
    const point = getGridPointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    setHoverPoint({ x: point.x, y: point.y });
    if (!isPointerDown || !dragStart) return;
    if (point.x === dragStart.x && point.y === dragStart.y) return;
    const rect = buildRectFromPoints(dragStart, point);
    setSelectedRect(rect);
    if (selectionConflicts(rect)) {
      setSelectionError("Obszar jest zajety lub zarezerwowany. Zmien rozmiar albo uzyj: Znajdz wolne miejsce.");
      return;
    }
    if (selectionTooSmall(rect)) {
      setSelectionError(`Minimalny rozmiar to ${MIN_SELECTION_SIZE}x${MIN_SELECTION_SIZE}`);
      return;
    }
    setSelectionError("");
  };

  const handleBoardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    setIsPointerDown(false);
    setDragStart(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleBlockMouseLeave = (event: React.MouseEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (isElement(nextTarget) && nextTarget.closest(".pixel-hover-chip")) return;
    setHoverPreview(null);
  };

  const handleContinue = async () => {
    if (!selectedRect || selectedPixelsCount === 0) return alert("Najpierw zaznacz prostokat pixel");
    if (selectedTooSmall) return alert(`Minimalny rozmiar zakupu to ${MIN_SELECTION_SIZE}x${MIN_SELECTION_SIZE}`);
    if (selectedHasTaken) return alert("Nie mozesz przejsc dalej, bo obszar zawiera zajete lub zarezerwowane pixel");
    const reserved = await reserveSelection(selectedRect);
    if (reserved) setStep("upload");
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreviewConfirmed(false);
    const reader = new FileReader();
    reader.onload = async () => {
      const rawImage = reader.result as string;
      setIsOptimizingImage(true);
      try {
        const optimized = await optimizeImageToLimit(
          rawImage,
          MAX_IMAGE_CHARS_CLIENT,
          selectedRect?.width,
          selectedRect?.height
        );
        setImage(optimized);
      } catch {
        setImage(rawImage);
      } finally {
        setIsOptimizingImage(false);
      }
      setIsPaid(false);
      setPaymentId(null);
      setPaidRect(null);
    };
    reader.readAsDataURL(file);
  };

  const goToCheckout = async () => {
    if (checkoutFlowInFlightRef.current) return;
    if (!selectedRect) { setStep("select"); return alert("Najpierw zaznacz pixel"); }
    if (selectedTooSmall) { setStep("select"); return alert(`Minimalny rozmiar zakupu to ${MIN_SELECTION_SIZE}x${MIN_SELECTION_SIZE}`); }
    if (!image) return alert("Dodaj obrazek przed platnoscia");
    if (!previewConfirmed) return alert("Najpierw potwierdz podglad");
    if (selectedHasTaken) { setStep("select"); return alert("Ten obszar zostal juz zajety. Wybierz inny."); }
    checkoutFlowInFlightRef.current = true;
    setIsCheckoutStarting(true);
    try {
      setIsModeratingImage(true);
      const moderationRes = await fetch("/api/images/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const moderationData = (await moderationRes.json()) as { success?: boolean; allowed?: boolean; message?: string };
      if (!moderationRes.ok || !moderationData.success || !moderationData.allowed) {
        alert(moderationData.message || "Obraz nie przeszedl automatycznej moderacji.");
        return;
      }

      const reserved = await reserveSelection(selectedRect);
      if (!reserved) return;
      setStep("checkout");
      await handlePay();
    } finally {
      setIsModeratingImage(false);
      checkoutFlowInFlightRef.current = false;
      setIsCheckoutStarting(false);
    }
  };

  const handlePay = async () => {
    if (payInFlightRef.current) return;
    if (!selectedRect) return alert("Najpierw zaznacz obszar");
    if (selectedHasTaken) return alert("Ten obszar jest zajety. Wybierz inny.");
    payInFlightRef.current = true;
    setIsPaying(true);
    try {
      const checkoutRes = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-id": getClientId() },
        body: JSON.stringify({
          amount: totalPrice,
          x: selectedRect.x,
          y: selectedRect.y,
          width: selectedRect.width,
          height: selectedRect.height,
        }),
      });
      const checkoutData = (await checkoutRes.json()) as PaymentCheckoutResponse;
      if (!checkoutRes.ok || !checkoutData.success || !checkoutData.paymentId || !checkoutData.checkoutUrl) {
        alert(checkoutData.message || "Nie udalo sie rozpoczac platnosci");
        return;
      }

      setPaymentId(checkoutData.paymentId);
      setIsPaid(false);
      setPaidRect(null);
      if (typeof window !== "undefined" && selectedRect && image) {
        const draft: CheckoutDraft = {
          rect: { ...selectedRect },
          image,
          fileName,
          targetUrl,
          adTitle,
          ownerName,
          ownerAvatar,
          previewConfirmed,
        };
        window.localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft));
      }

      window.location.assign(checkoutData.checkoutUrl);
    } catch {
      alert("Blad polaczenia z platnosciami");
    } finally {
      setIsPaying(false);
      payInFlightRef.current = false;
    }
  };

  const save = async () => {
    if (!selectedRect) {
      setStep("select");
      alert("Brak wybranego obszaru");
      return false;
    }
    if (selectedTooSmall) {
      setStep("select");
      alert(`Minimalny rozmiar zakupu to ${MIN_SELECTION_SIZE}x${MIN_SELECTION_SIZE}`);
      return false;
    }
    if (!image) {
      setStep("upload");
      alert("Dodaj obrazek");
      return false;
    }
    if (!isPaid || !paymentId) {
      alert("Najpierw zakoncz platnosc");
      return false;
    }
    if (selectedHasTaken) {
      setStep("select");
      alert("Nie mozna zapisac: ten obszar pixel jest juz kupiony albo zarezerwowany");
      return false;
    }

    setIsSaving(true);
    try {
      let imageToSave = image;
      if (imageToSave.length > MAX_IMAGE_CHARS_CLIENT) {
        imageToSave = await optimizeImageToLimit(
          imageToSave,
          MAX_IMAGE_CHARS_CLIENT,
          selectedRect.width,
          selectedRect.height
        );
        setImage(imageToSave);
      }
      if (imageToSave.length > MAX_IMAGE_CHARS_CLIENT) {
        setStep("upload");
        alert("Obraz jest nadal za duzy. Uzyj mniejszego pliku.");
        return false;
      }

      const res = await fetch("/api/pixels", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-id": getClientId() },
        body: JSON.stringify({
          ...selectedRect,
          image: imageToSave,
          url: targetUrl,
          title: adTitle,
          ownerName,
          ownerAvatar,
          paymentId,
        }),
      });
      const data = (await res.json()) as SaveResponse;
      if (!res.ok || !data.success) {
        alert(data.message || "Nie mozna zapisac pixel");
        if (res.status === 409) {
          setStep("select");
          await fetchPixels();
        }
        return false;
      }

      setSelectedRect(null);
      setImage(null);
      setFileName("Nie wybrano pliku");
      setTargetUrl("");
      setAdTitle("");
      setStep("select");
      setSelectionError("");
      setIsPaid(false);
      setPaymentId(null);
      setPaidRect(null);
      setPreviewConfirmed(false);
      if (typeof window !== "undefined") window.localStorage.removeItem(CHECKOUT_DRAFT_KEY);
      setCelebration({
        visible: true,
        message: "Twoj fragment jest juz na stronie",
        shareUrl: typeof window !== "undefined" ? `${window.location.origin}/?x=${selectedRect.x}&y=${selectedRect.y}&w=${selectedRect.width}&h=${selectedRect.height}` : "",
      });

      await claimReferralIfNeeded();
      await fetchPixels();
      await fetchTopAnalytics();
      return true;
    } catch {
      alert("Blad polaczenia z serwerem");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!isPaid || !paymentId) return;
    if (!selectedRect || !image) return;
    if (selectedTooSmall || selectedHasTaken) return;
    if (autoSavedPaymentIdRef.current === paymentId) return;

    autoSavedPaymentIdRef.current = paymentId;
    void (async () => {
      const ok = await save();
      if (!ok) {
        autoSavedPaymentIdRef.current = null;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, isPaid, paymentId, selectedHasTaken, selectedRect, selectedTooSmall]);

  const formatAgo = (dateValue?: string) => {
    if (!dateValue) return "przed chwila";
    const diff = Math.max(1, Math.floor((nowMs - Date.parse(dateValue)) / 1000));
    if (diff < 60) return `${diff}s temu`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m temu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h temu`;
    return `${Math.floor(diff / 86400)}d temu`;
  };

  const isHotPurchase = (createdAt?: string) => {
    if (!createdAt) return false;
    return nowMs - Date.parse(createdAt) <= 10 * 60 * 1000;
  };

  const handleShare = async () => {
    if (!celebration.shareUrl) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(celebration.shareUrl);
        alert("Link skopiowany");
        return;
      }
    } catch {}
    alert(celebration.shareUrl);
  };

  const trackBlockClick = async (id: string) => {
    if (!id) return;
    try {
      void fetch("/api/analytics/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        keepalive: true,
      });
    } catch {}
  };

  const claimReferralIfNeeded = async () => {
    if (typeof window === "undefined") return;
    const code = window.localStorage.getItem(REF_SOURCE_KEY)?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4,16}$/.test(code)) return;
    try {
      await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, claimerId: getClientId(), ownerCode: getReferralCode() }),
        keepalive: true,
      });
      window.localStorage.removeItem(REF_SOURCE_KEY);
      await fetchReferralStats();
    } catch {}
  };

  const updateMyBlock = async (id: string, title: string, url: string, nextOwnerName: string, nextOwnerAvatar: string) => {
    try {
      const res = await fetch("/api/pixels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-client-id": getClientId() },
        body: JSON.stringify({ id, title, url, ownerName: nextOwnerName, ownerAvatar: nextOwnerAvatar }),
      });
      const payload = (await res.json()) as SaveResponse;
      if (!res.ok || !payload.success) {
        alert(payload.message || "Nie mozna zapisac zmian");
        return;
      }
      await fetchPixels();
      alert("Zapisano zmiany bloku");
    } catch {
      alert("Blad polaczenia podczas aktualizacji");
    }
  };

  const getIntersectionStyle = (rect: SelectionRect) => {
    return {
      left: `${(rect.x / GRID_COLUMNS) * 100}%`,
      top: `${(rect.y / GRID_ROWS) * 100}%`,
      width: `${(rect.width / GRID_COLUMNS) * 100}%`,
      height: `${(rect.height / GRID_ROWS) * 100}%`,
    };
  };

  const loadImageElement = (dataUrl: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
      img.src = dataUrl;
    });

  const optimizeImageToLimit = async (
    dataUrl: string,
    maxChars: number,
    targetWidth?: number,
    targetHeight?: number
  ) => {
    if (dataUrl.length <= maxChars) return dataUrl;

    const img = await loadImageElement(dataUrl);
    let width = Math.max(1, Math.min(1000, targetWidth ?? img.naturalWidth));
    let height = Math.max(1, Math.min(1000, targetHeight ?? img.naturalHeight));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;

    const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5];

    while (width >= 10 && height >= 10) {
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const quality of qualities) {
        const next = canvas.toDataURL("image/webp", quality);
        if (next.length <= maxChars) return next;
      }

      width = Math.floor(width * 0.85);
      height = Math.floor(height * 0.85);
    }

    return canvas.toDataURL("image/webp", 0.5);
  };

  const panBy = (x: number, y: number) => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollBy({ left: x, top: y, behavior: "smooth" });
  };

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current || zoomLevel <= 1 || !event.altKey) return;
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current || !panRef.current) return;
    const dx = event.clientX - panRef.current.x;
    const dy = event.clientY - panRef.current.y;
    viewportRef.current.scrollLeft = panRef.current.left - dx;
    viewportRef.current.scrollTop = panRef.current.top - dy;
  };

  const handleViewportPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main className="pixel-site">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <h1 className="landing-brand-title">Pixel Polska</h1>
          <p className="landing-hero-tagline">1 zl = 1 pixel.</p>
          <div className="landing-cta-row">
            <a href="#kup-pixel" className="landing-cta landing-cta-primary">Kup pixel teraz</a>
          </div>
          <div className="landing-hero-stats">
            <article>
              <span>Sprzedane</span>
              <strong>{soldPixels}</strong>
            </article>
            <article>
              <span>Aktywni teraz</span>
              <strong>{activeViewers}</strong>
            </article>
          </div>
          <div className="landing-progress" aria-label="Postep sprzedazy">
            <div className="landing-progress-track">
              <div className="landing-progress-fill" style={{ width: `${soldPercent}%` }} />
            </div>
            <p>Sprzedane {soldPixels.toLocaleString("pl-PL")} / 1 000 000 pixel</p>
            <p>Ostatni zakup: {latestPurchaseLabel}</p>
          </div>
        </div>

        <aside className="landing-hero-quote" aria-label="Cytat">
          <p className="landing-hero-quote-text">&quot;Zostaw coś po sobie w internecie.&quot;</p>
        </aside>
      </section>

      <section className="pixel-how">
        <article>
          <strong>1</strong>
          <div>
            <span>Wybierz obszar i dopasuj rozmiar reklamy.</span>
            <small>Plansza 1000x1000, pelna kontrola miejsca.</small>
          </div>
        </article>
        <article>
          <strong>2</strong>
          <div>
            <span>Wgraj grafike, dodaj tytul i link do strony.</span>
            <small>Publikacja bez czekania na reczna obsluge.</small>
          </div>
        </article>
        <article>
          <strong>3</strong>
          <div>
            <span>Oplac i publikuj. Twoj blok dziala 24/7.</span>
            <small>Start kampanii od razu po finalizacji.</small>
          </div>
        </article>
      </section>

      {checkoutReturnState && (
        <section
          className={`pixel-checkout-return ${checkoutReturnState === "success" ? "is-success" : "is-cancel"}`}
          role="status"
          aria-live="polite"
        >
          <div className="pixel-checkout-return-main">
            <span className="pixel-checkout-return-badge">
              {checkoutReturnState === "success" ? "PLATNOSC OK" : "PLATNOSC ANULOWANA"}
            </span>
            <h3>{checkoutReturnState === "success" ? "Platnosc przyjeta" : "Platnosc anulowana"}</h3>
            <p>
              {checkoutReturnState === "success"
                ? (isPaid
                    ? "Pixel zapisany i opublikowany. Mozesz od razu sprawdzic swoj blok."
                    : "Wracamy z platnosci. Potwierdzamy status i za chwile opublikujemy blok.")
                : "Transakcja zostala anulowana. Mozesz sprobowac ponownie jednym kliknieciem."}
            </p>
          </div>
          <button type="button" className="pixel-btn pixel-btn-primary" onClick={() => setCheckoutReturnState(null)}>
            Zamknij
          </button>
        </section>
      )}

      <section className="pixel-proof">
        <div className="pixel-section-head">
          <p className="pixel-kicker">LIVE</p>
          <h3>Rosniemy na zywo</h3>
        </div>
        <p>Nowe bloki pojawiaja sie regularnie. Wejdz teraz, zanim najlepsze miejsca znikna.</p>
        <div className="pixel-proof-metrics">
          <span>Aktywni teraz: <strong>{activeViewers}</strong></span>
          <span>Zajete planszy: <strong>{soldPercent.toFixed(2)}%</strong></span>
        </div>
      </section>

      <section className="pixel-search">
        <div className="pixel-section-head">
          <p className="pixel-kicker">ODKRYWAJ</p>
          <h3>Wyszukaj kampanie</h3>
        </div>
        <input
          className="pixel-input pixel-search-input"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Nazwa, autor, domena..."
        />
        <p className="pixel-search-note">Wpisz minimum 2 znaki, aby szybko znalezc kampanie.</p>
        {hasSearchQuery && (
          <div className="pixel-search-results">
            {searchedBlocks.length === 0 && <p className="pixel-recent-empty">Brak wynikow</p>}
            {searchedBlocks.map((block) => (
              <button key={block.id} type="button" className="pixel-search-item" onClick={() => focusBlockOnBoard(block)}>
                <span className="pixel-search-title">{getBlockDisplayTitle(block)}</span>
                <small>{block.ownerName ? `${block.ownerName} | ` : ""}{block.width}x{block.height} px</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="pixel-referral">
        <div className="pixel-section-head">
          <div className="pixel-section-head-main">
            <p className="pixel-kicker">POLECAJ</p>
            <h3>Program polecen</h3>
          </div>
          <button
            type="button"
            className="pixel-collapse-btn"
            onClick={() => setIsReferralOpen((prev) => !prev)}
            aria-expanded={isReferralOpen}
            aria-controls="pixel-referral-content"
          >
            {isReferralOpen ? "Zwin" : "Rozwin"}
          </button>
        </div>
        {isReferralOpen && (
          <div id="pixel-referral-content">
            <div className="pixel-ref-shell">
              <div className="pixel-ref-metrics">
                <article className="pixel-ref-metric">
                  <span>Kod polecen</span>
                  <strong>{hydratedReferralCode}</strong>
                </article>
                <article className="pixel-ref-metric">
                  <span>Twoje polecenia</span>
                  <strong>{referralClaims}</strong>
                </article>
              </div>
              <p className="pixel-ref-note">Udostepnij link znajomym i buduj swoj ranking polecen.</p>
            </div>
            <button
              type="button"
              className="pixel-btn pixel-btn-primary pixel-ref-btn"
              onClick={async () => {
                const link = `${window.location.origin}/?ref=${getReferralCode()}`;
                  try {
                    await navigator.clipboard.writeText(link);
                    setRefCopied(true);
                  } catch {
                    alert(link);
                  }
                }}
            >
              {refCopied ? "Skopiowano link" : "Kopiuj link polecajacy"}
            </button>
          </div>
        )}
      </section>

      <section className="pixel-top-clicks">
        <article>
          <div className="pixel-top-head">
            <h3><strong>Top klikane 24h</strong></h3>
            <span>Trend dnia</span>
          </div>
          {top24h.length === 0 && (
            <div className="pixel-empty-state">
              <p className="pixel-recent-empty">Brak danych</p>
              <a href="#kup-pixel">Dodaj kampanie i zgarnij trend dnia</a>
            </div>
          )}
          <div className="pixel-top-list">
            {top24h.map((item) => (
              <button
                key={`24h-${item.id}`}
                type="button"
                className="pixel-top-item"
                onClick={() => {
                  const block = blocks.find((b) => b.id === item.id);
                  if (block) focusBlockOnBoard(block);
                }}
              >
                <span>{item.title || item.url || item.id.slice(-6)}</span>
                <strong>{item.clicks}</strong>
              </button>
            ))}
          </div>
        </article>
        <article>
          <div className="pixel-top-head">
            <h3><strong>Top klikane 7 dni</strong></h3>
            <span>Moc tygodnia</span>
          </div>
          {top7d.length === 0 && (
            <div className="pixel-empty-state">
              <p className="pixel-recent-empty">Brak danych</p>
              <a href="#kup-pixel">Uruchom kampanie i wejdz do rankingu</a>
            </div>
          )}
          <div className="pixel-top-list">
            {top7d.map((item) => (
              <button
                key={`7d-${item.id}`}
                type="button"
                className="pixel-top-item"
                onClick={() => {
                  const block = blocks.find((b) => b.id === item.id);
                  if (block) focusBlockOnBoard(block);
                }}
              >
                <span>{item.title || item.url || item.id.slice(-6)}</span>
                <strong>{item.clicks}</strong>
              </button>
            ))}
          </div>
        </article>
      </section>

      <section id="kup-pixel" className="pixel-app-shell">
        <div className="pixel-app-panel">
          <div className="pixel-stats">
            <article><span>Wybrane pixel</span><strong>{selectedPixelsCount}</strong></article>
            <article><span>Cena</span><strong>{totalPrice} zl</strong></article>
            <article>
              <span>Krok</span>
              <strong>{step === "select" ? "Wybieranie" : step === "upload" ? "Obraz" : "Platnosc"}</strong>
            </article>
            <article><span>Rezerwacja</span><strong>{reservationLabel}</strong></article>
            <article><span>Rozmiar zaznaczenia</span><strong>{selectedRect ? `${selectedRect.width}x${selectedRect.height}` : "-"}</strong></article>
          </div>

          {selectionError && <p className="pixel-alert">{selectionError}</p>}

          <section className="pixel-my-panel">
            <div className="pixel-panel-head">
              <h3>Moje bloki</h3>
              <button
                type="button"
                className="pixel-collapse-btn"
                onClick={() => setIsMyBlocksOpen((prev) => !prev)}
                aria-expanded={isMyBlocksOpen}
                aria-controls="pixel-my-blocks-content"
              >
                {isMyBlocksOpen ? "Zwin" : "Rozwin"}
              </button>
            </div>
            {isMyBlocksOpen && (
              <div id="pixel-my-blocks-content">
                {myBlocks.length === 0 && <p className="pixel-recent-empty">Nie masz jeszcze aktywnych blokow.</p>}
                <div className="pixel-my-list">
                  {myBlocks.map((block) => (
                    <article key={block.id} className="pixel-my-item">
                      <div className="pixel-my-thumb" style={{ backgroundImage: `url(${block.image})` }} aria-hidden />
                      <div className="pixel-my-meta">
                        <strong>{block.width}x{block.height} | klikniecia: {block.clickCount ?? 0}</strong>
                        <span>{formatAgo(block.createdAt)}</span>
                        <input className="pixel-input" id={`my-owner-name-${block.id}`} defaultValue={block.ownerName || ""} placeholder="Nazwa autora" maxLength={32} />
                        <input className="pixel-input" id={`my-owner-avatar-${block.id}`} defaultValue={block.ownerAvatar || ""} placeholder="Avatar (emoji)" maxLength={8} />
                        <input className="pixel-input" id={`my-title-${block.id}`} defaultValue={block.title || ""} placeholder="Tytul bloku" />
                        <input className="pixel-input" id={`my-url-${block.id}`} defaultValue={block.url || ""} placeholder="https://twoja-strona.pl" />
                        <div className="pixel-my-actions">
                          <button
                            type="button"
                            className="pixel-btn pixel-btn-secondary"
                            onClick={() => {
                              const titleInput = document.getElementById(`my-title-${block.id}`) as HTMLInputElement | null;
                              const urlInput = document.getElementById(`my-url-${block.id}`) as HTMLInputElement | null;
                              const nameInput = document.getElementById(`my-owner-name-${block.id}`) as HTMLInputElement | null;
                              const avatarInput = document.getElementById(`my-owner-avatar-${block.id}`) as HTMLInputElement | null;
                              void updateMyBlock(
                                block.id,
                                titleInput?.value ?? "",
                                urlInput?.value ?? "",
                                nameInput?.value ?? "",
                                avatarInput?.value ?? ""
                              );
                            }}
                          >
                            Zapisz
                          </button>
                          <button type="button" className="pixel-btn pixel-btn-primary" onClick={() => focusBlockOnBoard(block)}>
                            Pokaz na planszy
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="pixel-recent">
            <h3>Wlasnie kupione</h3>
            <div className="pixel-recent-list">
              {recentPurchases.length === 0 && <p className="pixel-recent-empty">Brak zakupow</p>}
              {recentPurchases.map((block, index) => (
                <article
                  key={`${block.x}-${block.y}-${index}`}
                  className="pixel-recent-item pixel-recent-item-clickable"
                  onClick={() => focusBlockOnBoard(block)}
                >
                  <div className="pixel-recent-thumb" style={{ backgroundImage: `url(${block.image})` }} aria-hidden />
                  <div>
                    <strong>
                      {block.width}x{block.height} {isHotPurchase(block.createdAt) && <span className="pixel-hot-badge">HOT</span>}
                    </strong>
                    <p>{block.width * block.height} zl | {formatAgo(block.createdAt)}</p>
                    {(block.ownerName || block.ownerAvatar) && (
                      <p>{[block.ownerAvatar, block.ownerName].filter(Boolean).join(" ")}</p>
                    )}
                    {block.url && (
                      <a
                        className="pixel-recent-link"
                        href={block.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          event.stopPropagation();
                          void trackBlockClick(block.id);
                        }}
                      >
                        {block.title || block.url}
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="pixel-actions-row">
            {step === "select" && (
              <>
                <button className="pixel-btn pixel-btn-primary" onClick={handleContinue} disabled={!selectedRect || selectedHasTaken || selectedTooSmall || isReserving}>
                  {isReserving ? "Rezerwowanie..." : "Dalej"}
                </button>
                <button className="pixel-btn pixel-btn-secondary" onClick={handleFindFreeSpot}>Znajdz wolne miejsce</button>
                <button className="pixel-btn pixel-btn-secondary" onClick={snapSelectionToNearestPack} disabled={!selectedRect}>Snap do pakietu</button>
                <button className="pixel-btn pixel-btn-secondary" onClick={() => handlePackSelect(10, 10)}>Pakiet 10x10</button>
                <button className="pixel-btn pixel-btn-secondary" onClick={() => handlePackSelect(25, 25)}>Pakiet 25x25</button>
                <button className="pixel-btn pixel-btn-secondary" onClick={() => handlePackSelect(50, 50)}>Pakiet 50x50</button>
                <button className="pixel-btn pixel-btn-secondary" onClick={() => handlePackSelect(100, 100)}>Pakiet 100x100</button>
                {recommendedSpots.map((spot) => (
                  <button
                    key={`${spot.rect.x}-${spot.rect.y}-${spot.label}`}
                    className="pixel-btn pixel-btn-secondary"
                    onClick={() => {
                      if (selectedRect) setPreviousSelection(selectedRect);
                      setSelectedRect(spot.rect);
                      setStep("select");
                      setSelectionError("");
                    }}
                  >
                    Polecane {spot.label}
                  </button>
                ))}
                <button className="pixel-btn pixel-btn-secondary" onClick={clearSelection} disabled={!selectedRect}>Wyczysc wybor</button>
                <button className="pixel-btn pixel-btn-secondary" onClick={restorePreviousSelection} disabled={!previousSelection}>Wroc do poprzedniego</button>
              </>
            )}

            {step === "upload" && (
              <>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
                <button className="pixel-btn pixel-btn-secondary" onClick={openFilePicker}>Wybierz obrazek</button>
                <input
                  className="pixel-input"
                  type="text"
                  value={adTitle}
                  onChange={(event) => {
                    setAdTitle(event.target.value);
                    setPreviewConfirmed(false);
                  }}
                  placeholder="Tytul (opcjonalnie)"
                  maxLength={80}
                />
                <input
                  className="pixel-input"
                  type="text"
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  placeholder="Nazwa autora (opcjonalnie)"
                  maxLength={32}
                />
                <input
                  className="pixel-input"
                  type="text"
                  value={ownerAvatar}
                  onChange={(event) => setOwnerAvatar(event.target.value)}
                  placeholder="Avatar emoji (opcjonalnie)"
                  maxLength={8}
                />
                <input
                  className="pixel-input"
                  type="url"
                  value={targetUrl}
                  onChange={(event) => {
                    setTargetUrl(event.target.value);
                    setPreviewConfirmed(false);
                  }}
                  placeholder="https://twoja-strona.pl (opcjonalnie)"
                />
                <button className="pixel-btn pixel-btn-primary" onClick={goToCheckout} disabled={!image || !previewConfirmed || isReserving || isOptimizingImage || isCheckoutStarting || isModeratingImage}>
                  {isOptimizingImage
                    ? "Optymalizowanie..."
                    : isModeratingImage
                      ? "Sprawdzanie obrazu..."
                      : isReserving
                        ? "Rezerwowanie..."
                        : isCheckoutStarting
                          ? "Przygotowanie platnosci..."
                          : "Przejdz do platnosci"}
                </button>
                <span className="pixel-file-name">{fileName}</span>
              </>
            )}
          </div>

          {step !== "select" && selectedRect && (
            <section className="pixel-preview-panel">
              <h3>Podglad przed zakupem</h3>
              <div className="pixel-preview-grid">
                <div className="pixel-preview-card">
                  {image ? (
                    <div
                      className="pixel-preview-image"
                      style={{
                        backgroundImage: `url(${image})`,
                      }}
                    />
                  ) : (
                    <div className="pixel-preview-placeholder">Dodaj obrazek aby zobaczyc podglad</div>
                  )}
                </div>
                <div className="pixel-preview-meta">
                  <p><strong>Rozmiar:</strong> {selectedRect.width}x{selectedRect.height} pixel</p>
                  <p><strong>Cena:</strong> {selectedRect.width * selectedRect.height} zl</p>
                  <p><strong>Tytul:</strong> {adTitle.trim() || "-"}</p>
                  <p><strong>Autor:</strong> {[ownerAvatar.trim(), ownerName.trim()].filter(Boolean).join(" ") || "-"}</p>
                  <p><strong>Link:</strong> {targetUrl.trim() || "-"}</p>
                </div>
              </div>
              <label className="pixel-checkbox-row" htmlFor="accept-preview">
                <input
                  id="accept-preview"
                  type="checkbox"
                  checked={previewConfirmed}
                  onChange={(event) => setPreviewConfirmed(event.target.checked)}
                />
                <span>Potwierdzam, ze podglad jest OK</span>
              </label>
            </section>
          )}

          <div className="pixel-workspace">
            <div className="pixel-zoom-controls">
              <button className="pixel-btn pixel-btn-secondary" onClick={() => setZoomLevel((prev) => Math.max(1, +(prev - 0.25).toFixed(2)))} type="button">-</button>
              <span>Zoom: {Math.round(zoomLevel * 100)}%</span>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => setZoomLevel((prev) => Math.min(3, +(prev + 0.25).toFixed(2)))} type="button">+</button>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => setZoomLevel(1)} type="button">Reset zoom</button>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => panBy(-240, 0)} type="button">Left</button>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => panBy(240, 0)} type="button">Right</button>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => panBy(0, -180)} type="button">Up</button>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => panBy(0, 180)} type="button">Down</button>
              <span>Pan: Alt + drag</span>
              <span className="pixel-help-tip" title="Zaznaczanie dziala jako: lewy przycisk myszy + przeciaganie po planszy.">
                LPM + przeciagnij
              </span>
            </div>

            <div className="pixel-board-frame">
              <div
                className={`pixel-board-viewport ${zoomLevel > 1 ? "is-pannable" : ""} ${isPanning ? "is-panning" : ""}`}
                ref={viewportRef}
                onPointerDown={handleViewportPointerDown}
                onPointerMove={handleViewportPointerMove}
                onPointerUp={handleViewportPointerUp}
                onPointerCancel={handleViewportPointerUp}
              >
                <div
                  className="pixel-board-wrap"
                  style={{ width: `${zoomLevel * 100}%`, minWidth: "100%" }}
                  ref={boardRef}
                  onContextMenu={(event) => event.preventDefault()}
                  onPointerDown={handleBoardPointerDown}
                  onPointerMove={handleBoardPointerMove}
                  onPointerUp={handleBoardPointerUp}
                  onPointerCancel={handleBoardPointerUp}
                  onPointerLeave={() => setHoverPoint(null)}
                >
                  <div className="pixel-board-surface" style={{ backgroundSize: `${(VISUAL_GRID_STEP / GRID_COLUMNS) * 100}% ${(VISUAL_GRID_STEP / GRID_ROWS) * 100}%` }} />

                  <div className="pixel-board-overlays">
                    {blocks.map((block) => {
                      const isMatched = searchedIds.has(block.id);
                      const isFresh = isHotPurchase(block.createdAt);
                      const commonStyle = {
                        position: "absolute" as const,
                        ...getIntersectionStyle(block),
                        backgroundImage: `url(${block.image})`,
                        backgroundSize: "contain",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                        backgroundColor: "rgba(255,255,255,0.92)",
                        border: isMatched ? "2px solid #facc15" : "1px solid rgba(255,255,255,0.35)",
                        borderRadius: "0.15rem",
                        boxShadow: isMatched ? "0 0 0 2px rgba(146,64,14,0.45)" : undefined,
                      };

                      return block.url ? (
                        <a
                          key={block.id}
                          className={isFresh ? "pixel-block-fresh" : undefined}
                          href={block.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={getBlockDisplayTitle(block)}
                          onClick={(event) => {
                            if (isPointerDown) {
                              event.preventDefault();
                              return;
                            }
                            void trackBlockClick(block.id);
                          }}
                          onMouseEnter={() =>
                            setHoverPreview({
                              id: block.id,
                              title: getBlockDisplayTitle(block),
                              url: block.url,
                              ownerName: block.ownerName,
                              ownerAvatar: block.ownerAvatar,
                              rect: { x: block.x, y: block.y, width: block.width, height: block.height },
                            })
                          }
                          onFocus={() =>
                            setHoverPreview({
                              id: block.id,
                              title: getBlockDisplayTitle(block),
                              url: block.url,
                              ownerName: block.ownerName,
                              ownerAvatar: block.ownerAvatar,
                              rect: { x: block.x, y: block.y, width: block.width, height: block.height },
                            })
                          }
                          onMouseLeave={handleBlockMouseLeave}
                          onBlur={() => setHoverPreview(null)}
                          style={{
                            ...commonStyle,
                            pointerEvents: "auto",
                          }}
                        />
                      ) : (
                        <div
                          key={block.id}
                          className={isFresh ? "pixel-block-fresh" : undefined}
                          onMouseEnter={() =>
                            setHoverPreview({
                              id: block.id,
                              title: getBlockDisplayTitle(block),
                              ownerName: block.ownerName,
                              ownerAvatar: block.ownerAvatar,
                              rect: { x: block.x, y: block.y, width: block.width, height: block.height },
                            })
                          }
                          onMouseLeave={handleBlockMouseLeave}
                          style={{
                            ...commonStyle,
                            pointerEvents: "none",
                          }}
                        />
                      );
                    })}

                    {hoverPreview && (
                      <div
                        className={`pixel-hover-chip ${hoverPreview.url ? "" : "is-static"} ${hoverPreview.rect.y > 70 ? "is-above" : "is-below"}`}
                        onMouseLeave={(event) => {
                          const nextTarget = event.relatedTarget;
                          if (isElement(nextTarget) && nextTarget.closest("a,button,.pixel-hover-chip")) return;
                          setHoverPreview(null);
                        }}
                        style={{
                          left: `${((hoverPreview.rect.x + hoverPreview.rect.width / 2) / GRID_COLUMNS) * 100}%`,
                          top: `${((hoverPreview.rect.y + (hoverPreview.rect.y > 70 ? -2 : hoverPreview.rect.height + 2)) / GRID_ROWS) * 100}%`,
                          pointerEvents: step === "select" ? "none" : "auto",
                        }}
                      >
                        <strong>{hoverPreview.title}</strong>
                        {(hoverPreview.ownerName || hoverPreview.ownerAvatar) && (
                          <span>{[hoverPreview.ownerAvatar, hoverPreview.ownerName].filter(Boolean).join(" ")}</span>
                        )}
                        <span>{hoverPreview.url ? "Kliknij blok, aby przejsc" : "Brak zapisanego URL"}</span>
                      </div>
                    )}

                    {activeOtherReservations.map((reservation) => (
                      <div
                        key={reservation.id}
                      style={{
                        position: "absolute",
                        ...getIntersectionStyle(reservation),
                        backgroundColor: "rgba(244, 63, 94, 0.24)",
                        border: "2px solid rgba(190, 24, 93, 0.85)",
                        borderRadius: "0.2rem",
                        pointerEvents: "none",
                      }}
                    />
                  ))}

                    {selectedRect && !selectedHasTaken && (
                      <div
                        style={{
                          position: "absolute",
                          ...getIntersectionStyle(selectedRect),
                          backgroundImage: image ? `url(${image})` : undefined,
                          backgroundSize: "contain",
                          backgroundPosition: "center",
                          backgroundRepeat: "no-repeat",
                      backgroundColor: image ? "transparent" : "rgba(37, 99, 235, 0.15)",
                      border: "2px dashed #0ea5e9",
                      borderRadius: "0.2rem",
                      opacity: 0.92,
                      pointerEvents: "none",
                    }}
                  />
                )}

                    {selectedRect && selectedHasTaken && (
                      <div
                        style={{
                          position: "absolute",
                          ...getIntersectionStyle(selectedRect),
                      backgroundColor: "rgba(245, 158, 11, 0.35)",
                      border: "2px solid #f59e0b",
                      borderRadius: "0.2rem",
                      pointerEvents: "none",
                    }}
                  />
                )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pixel-statusbar">
            <span>Kursor: {hoverPoint ? `${hoverPoint.x}, ${hoverPoint.y}` : "-"}</span>
            <span>Wybor: {selectedRect ? `${selectedRect.width}x${selectedRect.height}` : "-"}</span>
            <span>Drag: {dragSizeLabel}</span>
            <span>Pixel: {selectedPixelsCount}</span>
            <span>Cena: {totalPrice} zl</span>
            <span>Rezerwacja: {reservationLabel}</span>
          </div>

          <footer className="pixel-checkout-panel">
            {isPaid && paidRect && (
              <p className="pixel-checkout-note">
                Platnosc aktywna dla: {paidRect.width}x{paidRect.height} @ {paidRect.x},{paidRect.y}
              </p>
            )}
          </footer>

          <footer className="pixel-footer">
            <div className="pixel-footer-cols">
              <section>
                <h3>Kontakt</h3>
                <p>Email: kontakt@pixelpolska.pl</p>
                <p>Instagram: @pixelpolska</p>
              </section>
              <section>
                <h3>Regulamin</h3>
                <details>
                  <summary>Pokaz skrot</summary>
                  <p>Zakupiony obszar jest publikowany po zakonczeniu platnosci.</p>
                  <p>Obraz nie moze naruszac prawa ani regulaminu serwisu.</p>
                  <p>Rezerwacja obszaru wygasa po 2 minutach.</p>
                </details>
              </section>
            </div>
          </footer>

          <section className="pixel-pay-history">
            <h3>Historia platnosci i faktury</h3>
            {paymentHistory.length === 0 && <p className="pixel-recent-empty">Brak historii platnosci.</p>}
            <div className="pixel-pay-list">
              {paymentHistory.map((item) => (
                <article key={item.id} className="pixel-pay-item">
                  <strong>{item.invoiceNo}</strong>
                  <span>{item.amount} zl | {item.rect.width}x{item.rect.height} | {item.status}</span>
                  <span>{formatAgo(item.createdAt)}</span>
                </article>
              ))}
            </div>
          </section>

          {celebration.visible && (
            <div className="pixel-celebration" role="status" aria-live="polite">
              <div className="pixel-confetti">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <strong>{celebration.message}</strong>
              <button className="pixel-btn pixel-btn-primary" onClick={handleShare}>Udostepnij</button>
            </div>
          )}
        </div>
      </section>
      <a href="#kup-pixel" className="pixel-mobile-cta">Kup pixel teraz</a>
    </main>
  );
}




