import type { Metadata } from "next";
import { Bungee, Geist, Geist_Mono } from "next/font/google";
import { WebVitals } from "./_components/web-vitals";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const brandFont = Bungee({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: "400",
});

const siteUrl = "https://pixelpolska.pl";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Pixel Polska | Reklama na planszy 1 000 000 pixel",
    template: "%s | Pixel Polska",
  },
  description:
    "Kup i zarzadzaj swoim obszarem na wspolnej planszy 1 000 000 pixel. 1 zl za 1 pixel, szybka publikacja i widocznosc 24/7.",
  alternates: {
    canonical: "/",
  },
  keywords: [
    "pixel polska",
    "reklama internetowa",
    "plansza pixel",
    "kup pixel",
    "pixel marketing",
  ],
  category: "marketing",
  openGraph: {
    title: "Pixel Polska",
    description: "1 000 000 pixel. Kup swoj obszar i pokaz marke online.",
    url: siteUrl,
    siteName: "Pixel Polska",
    locale: "pl_PL",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Pixel Polska - plansza pixel" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pixel Polska",
    description: "1 000 000 pixel. Kup swoj obszar i pokaz marke online.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} ${brandFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WebVitals />
        {children}
      </body>
    </html>
  );
}
