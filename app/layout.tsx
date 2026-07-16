import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ruta Verde · Santuario",
  description: "Control operativo del recorrido de reciclaje del viernes.",
  manifest: "/manifest.webmanifest",
  themeColor: "#123a31",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/logo-ruta-verde.svg",
    shortcut: "/logo-ruta-verde.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
