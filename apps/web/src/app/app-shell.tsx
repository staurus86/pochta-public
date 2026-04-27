'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/ui/Sidebar';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: 2,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen">
        <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
        <main
          className="flex-1 min-h-screen bg-surface-primary transition-all duration-200"
          style={{ marginLeft: collapsed ? '4rem' : '14rem' }}
        >
          <div className="p-6">{children}</div>
        </main>
      </div>
    </QueryClientProvider>
  );
}
