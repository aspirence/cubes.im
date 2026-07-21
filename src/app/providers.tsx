"use client";

import { useEffect, useState } from "react";
import { ConfigProvider, App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@ant-design/v5-patch-for-react-19";
import { getThemeConfig } from "@/lib/theme";
import { useUIStore } from "@/store/ui-store";
import { I18nProvider } from "@/lib/i18n/provider";
import { AuthProvider } from "@/features/auth/auth-provider";
import { registerServiceWorker } from "@/features/pwa/use-pwa";

/**
 * Client-side provider tree:
 *   ConfigProvider (antd theme, switched by zustand theme mode)
 *   -> React Query
 *   -> i18n
 *   -> antd App (message/notification/modal static context)
 *   -> Auth (Supabase session + public.users profile)
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const themeMode = useUIStore((s) => s.themeMode);

  // Mirror the theme onto <html> so global CSS (scrollbars, card elevation,
  // borders) can target `.theme-dark`, in sync with Ant Design's algorithm.
  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", themeMode === "dark");
  }, [themeMode]);

  // Register the service worker (installability + Web Push). Idempotent.
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ConfigProvider theme={getThemeConfig(themeMode)}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <AntdApp>
            <AuthProvider>{children}</AuthProvider>
          </AntdApp>
        </I18nProvider>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
