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
  primary: 'bg-emerald-500 text-white hover:bg-emerald-400',
  secondary: 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700',
  ghost: 'bg-transparent text-gray-400 hover:text-white hover:bg-zinc-800',
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
        <span>📤</span>
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
