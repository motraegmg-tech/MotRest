import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "Facturación | MOTRAE",
  description: "Solicita la factura de tu consumo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-MX">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased bg-gray-50 text-gray-900 min-h-screen`}
      >
        <main className="max-w-xl mx-auto min-h-screen flex flex-col p-4 md:p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
