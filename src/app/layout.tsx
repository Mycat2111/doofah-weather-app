import type { Metadata, Viewport } from "next";
import { Anuphan, Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/i18n/I18nProvider";
import { MESSAGES } from "@/i18n/messages";
import { getRequestLocale } from "@/i18n/server";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Thai glyphs only: Latin letters and digits keep using Geist in both languages.
const anuphan = Anuphan({
  variable: "--font-thai",
  subsets: ["thai"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = MESSAGES[await getRequestLocale()];
  return { title: meta.title, description: meta.description };
}

export const viewport: Viewport = {
  themeColor: "#0b1026",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getRequestLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${anuphan.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
