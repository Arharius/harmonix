import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmonix | Audio to Sheet Music",
  description: "Convert your voice or music into professional sheet music instantly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
