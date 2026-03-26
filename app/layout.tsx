import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import { TelemetryClient } from '@/components/telemetry/TelemetryClient';
import { Analytics } from '@vercel/analytics/next';

const inter = Inter({ subsets: ['latin'] });
const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const metadata: Metadata = {
  title: 'Restaurant IQ | 北美华人餐厅 AI 智能运营 Agent 平台',
  description: '整合POS、外卖平台、社媒与宏观数据，生成可执行运营建议，并支持滑动确认与快速回滚。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <TelemetryClient />
        <Toaster richColors theme="dark" position="top-right" />
        <Analytics />
      </body>
    </html>
  );

  if (isMockMode || !isClerkConfigured) {
    return content;
  }

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#F26A36',
          colorBackground: '#0A0A0A',
          colorText: '#F5F5F5',
          colorTextSecondary: '#D4D4D8',
          colorInputText: '#F5F5F5',
          colorInputBackground: '#111827',
        },
        elements: {
          card: 'bg-slate-900/90 border border-slate-700 shadow-2xl backdrop-blur-sm',
          headerTitle: 'text-zinc-100',
          headerSubtitle: 'text-zinc-300',
          formFieldLabel: 'text-zinc-200',
          formFieldInput: 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-400',
          formButtonPrimary: 'bg-orange-500 text-black hover:bg-orange-400',
          footerActionText: 'text-zinc-400',
          footerActionLink: 'text-orange-400 hover:text-orange-300',
          dividerText: 'text-zinc-400',
          dividerLine: 'bg-zinc-800',
          socialButtonsBlockButton: 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800',
          socialButtonsBlockButtonText: 'text-zinc-100',
          identityPreviewText: 'text-zinc-100',
          formFieldHintText: 'text-zinc-400',
          formFieldErrorText: 'text-red-400',
          alert: 'bg-zinc-900 border-zinc-700',
          alertText: 'text-zinc-100',
          otpCodeFieldInput: 'bg-zinc-900 border-zinc-700 text-zinc-100',
        },
      }}
    >
      {content}
    </ClerkProvider>
  );
}