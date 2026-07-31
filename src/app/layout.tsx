import type { Metadata } from "next";
import { NavShell } from "@/components/nav/NavShell";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overdue",
  description: "Know what is coming, and when.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scheme="dark"
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavShell>{children}</NavShell>
      </body>
    </html>
  );
}
