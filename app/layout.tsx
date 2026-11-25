import type { Metadata } from "next";
import { LockInRoot } from "@/components/lockin/LockInRoot";
import { BOOT_SCRIPT } from "@/lib/lockin/keys";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Margin", template: "%s · Margin" },
  description: "Turn a course folder into sections you learn by interacting with them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions (one adds data-qb-installed) write attributes onto <html> before React hydrates, and the lock in script below
    // adds data-lockin. This only silences mismatches in <html>'s own attributes; hydration warnings anywhere else still show.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Lock in is remembered in localStorage: put it back before the first paint, so a locked-in student never sees the decoration flash.
            Some browser extensions rewrite this tag before React loads; suppressHydrationWarning keeps that from being reported as an error. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        <LockInRoot>{children}</LockInRoot>
      </body>
    </html>
  );
}
