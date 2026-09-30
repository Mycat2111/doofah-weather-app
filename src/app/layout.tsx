import type { Metadata, Viewport } from "next";
import { Anuphan, Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/AppProviders";
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
  return {
    title: meta.title,
    description: meta.description,
    applicationName: "DooFah",
    // Home-screen app on iOS: full screen, with the sky showing behind the status bar.
    appleWebApp: { capable: true, title: "DooFah", statusBarStyle: "black-translucent" },
    // Stops iOS turning numbers such as "1012" (hPa) into phone links.
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  // Updated to the top colour of the sky as the weather changes (AtmosphereBackground).
  themeColor: "#0b1026",
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home indicator; globals.css pads the content back in.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getRequestLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${anuphan.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppProviders locale={locale}>{children}</AppProviders>
      </body>
    </html>
  );
}
