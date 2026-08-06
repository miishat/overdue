import type { Metadata, Viewport } from "next";
import { PALETTE } from "@/lib/tokens";
import { NavShell } from "@/components/nav/NavShell";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overdue",
  description: "Know what is coming, and when.",
  // Emits <meta name="mobile-web-app-capable" content="yes"> and
  // <meta name="apple-mobile-web-app-title">, which is what makes an added
  // home screen icon open without Safari chrome. Without it, iOS opens the
  // site in a browser view, display-mode never reports standalone, and web
  // push is impossible. Verified in node_modules/next/dist/docs/01-app/
  // 03-api-reference/04-functions/generate-metadata.md, "appleWebApp".
  appleWebApp: {
    capable: true,
    title: "Overdue",
    statusBarStyle: "default",
  },
  icons: {
    // Named icon-* rather than apple-icon so it matches the existing
    // ungated pattern in src/proxy.ts. See the long comment above
    // `export const config` there: the manifest icons had to be ungated
    // because install machinery fetches them without the gate cookie, and
    // the apple touch icon is fetched the same way.
    // 192x192 rather than the 180x180 iOS nominally wants. It is a copy of
    // icon-192.png, and iOS scales it without complaint. The declared size
    // states what the file actually is: claiming 180 for a 192 image would be
    // a small lie in a codebase whose whole point is not making claims it
    // cannot back.
    apple: [{ url: "/icon-apple-192.png", sizes: "192x192", type: "image/png" }],
  },
};

// themeColor moved out of metadata: Next requires it on the viewport export,
// and leaving it on metadata logs a deprecation warning at build time. The
// value matches src/app/manifest.ts, which reads the same palette token, so
// the browser chrome and the splash screen agree.
export const viewport: Viewport = {
  themeColor: PALETTE.dark.ink,
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
        <OfflineBanner />
        <NavShell>{children}</NavShell>
      </body>
    </html>
  );
}
