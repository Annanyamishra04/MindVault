import type { Metadata } from "next";
// Self-hosted via @fontsource rather than next/font/google: identical
// visual result, but no build-time or runtime dependency on Google's
// font CDN (relevant both for this sandbox's restricted network and for
// avoiding an external request from every visitor's browser).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindVault — AI-Powered Smart Notes",
  description:
    "Your notes are not just stored. AI understands them. MindVault summarizes, tags, and answers questions about your own notes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
