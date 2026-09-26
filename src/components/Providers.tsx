"use client";

import { SessionProvider } from "next-auth/react";
import { Analytics } from "@vercel/analytics/react";
import { SentryUserContext } from "@/components/SentryUserContext";
import { PWAProvider } from "@/components/PWAProvider";
import { IntlProvider } from "@/components/IntlProvider";
import { QueryInvalidationProvider } from "@/lib/queryInvalidation";

interface ProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: any;
}

export function Providers({ children, locale, messages }: ProvidersProps) {
  return (
    <SessionProvider>
      <IntlProvider locale={locale} messages={messages}>
        <QueryInvalidationProvider>
          <SentryUserContext />
          {children}
          <PWAProvider />
          <Analytics />
        </QueryInvalidationProvider>
      </IntlProvider>
    </SessionProvider>
  );
}
