'use client';

import { useState } from 'react';
import { ShareModal } from './ShareModal';
import type { SharePlatform } from '@/lib/share/utm';
import type { Locale } from '@/lib/i18n/locale';

type ShareButtonProps = {
  shareUrl: string;
  title: string;
  description?: string;
  reportId?: string;
  locale?: Locale;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onShare?: (platform: SharePlatform) => void;
};

const copy: Record<Locale, { share: string }> = {
  en: { share: 'Share' },
  zh: { share: '分享' },
  es: { share: 'Compartir' },
};

const variants = {
  primary: 'bg-brand-navy text-white hover:bg-[#1B2537]',
  secondary: 'border border-zinc-300 bg-white text-brand-navy hover:bg-zinc-50',
  ghost: 'bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-brand-navy',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function ShareButton({
  shareUrl,
  title,
  description,
  reportId,
  locale = 'en',
  variant = 'secondary',
  size = 'md',
  className = '',
  onShare,
}: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = copy[locale];

  const handleShare = async (platform: SharePlatform) => {
    onShare?.(platform);

    if (reportId) {
      try {
        await fetch('/api/funnel/track-share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId, platform }),
        }).catch(() => {});
      } catch {}
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-2 rounded-xl font-medium transition ${variants[variant]} ${sizes[size]} ${className}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13" />
        </svg>
        <span>{t.share}</span>
      </button>

      <ShareModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        shareUrl={shareUrl}
        title={title}
        description={description}
        reportId={reportId}
        locale={locale}
        onShare={handleShare}
      />
    </>
  );
}
