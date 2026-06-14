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

export const metadata: Metadata = {
  title: "BatchPort",
  description:
    "Personal travel tracker. See where you have been and plan where you are going.",
  applicationName: "BatchPort",
  appleWebApp: {
    capable: true,
    title: "BatchPort",
    statusBarStyle: "black-translucent",
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
