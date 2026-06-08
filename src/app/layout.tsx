import type { Metadata } from "next";
import { CalSansUI } from "@calcom/cal-sans-ui";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationSounds } from "@/components/notifications/notification-sounds";
import "./globals.css";

const calSansHeading = localFont({
  src: "../../node_modules/cal-sans/fonts/webfonts/CalSans-SemiBold.woff2",
  display: "swap",
  variable: "--font-cal-sans",
  weight: "600",
});

export const metadata: Metadata = {
  title: "FlowerBuro | sellz",
  description: "Backoffice for a flower shop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${CalSansUI.variable} ${calSansHeading.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <TooltipProvider>
          {children}
          <Toaster richColors closeButton />
          {/* Глобальный звуковой островок: уведомления о новых заказах/сделках на любой странице. */}
          <NotificationSounds />
        </TooltipProvider>
      </body>
    </html>
  );
}
