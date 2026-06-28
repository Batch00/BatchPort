import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

// Inter, exposed as the --font-sans CSS variable that globals.css maps onto the
// Tailwind font-sans token.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const description = "Track your travels around the world";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "BatchPort",
    template: "%s | BatchPort",
  },
  description,
  applicationName: "BatchPort",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BatchPort",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "BatchPort",
    title: "BatchPort",
    description,
    url: appUrl,
    images: [
      { url: "/icons/icon-512.png", width: 512, height: 512, alt: "BatchPort" },
    ],
  },
  twitter: {
    card: "summary",
    title: "BatchPort",
    description,
    images: ["/icons/icon-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The `dark` class makes the dark token set the default for the whole app.
  return (
    <html lang="en" className={`${inter.variable} dark h-full`}>
      <body className="flex min-h-full flex-col antialiased">
        {children}
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
