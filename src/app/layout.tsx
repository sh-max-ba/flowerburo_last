import type { Metadata } from "next";
import { Golos_Text } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationSounds } from "@/components/notifications/notification-sounds";
import { VersionWatcher } from "@/components/system/version-watcher";
import { getBuildId } from "@/lib/build-id";
import "./globals.css";

const golosText = Golos_Text({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-golos",
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
      className={`${golosText.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <TooltipProvider>
          {children}
          <Toaster richColors closeButton />
          {/* Глобальный звуковой островок: уведомления о новых заказах/сделках на любой странице. */}
          <NotificationSounds />
          {/* Авто-перезагрузка устаревших вкладок после деплоя (см. VersionWatcher). */}
          <VersionWatcher currentBuildId={getBuildId()} />
        </TooltipProvider>
      </body>
    </html>
  );
}
