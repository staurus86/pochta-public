import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './app-shell';

export const metadata: Metadata = {
  title: 'Pochta CRM — Email Intelligence Platform',
  description: 'Автоматическая обработка и классификация входящей почты',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
