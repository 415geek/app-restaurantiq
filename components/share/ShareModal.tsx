'use client';

import { useEffect, useState, useCallback } from 'react';
import { appendUtmToUrl, buildSocialShareUrl, type SharePlatform } from '@/lib/share/utm';
import type { Locale } from '@/lib/i18n/locale';

type ShareModalProps = {
  isOpen: boolean;
  onClose: () => void;
  shareUrl: string;
  title: string;
  description?: string;
  reportId?: string;
  locale?: Locale;
  onShare?: (platform: SharePlatform) => void;
};

type WechatConfig = {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
  jsApiList: string[];
};

declare global {
  interface Window {
    wx?: {
      config: (config: WechatConfig & { debug?: boolean }) => void;
      ready: (callback: () => void) => void;
      error: (callback: (res: unknown) => void) => void;
      updateAppMessageShareData: (config: {
        title: string;
        desc: string;
        link: string;
        imgUrl: string;
        success?: () => void;
        fail?: () => void;
      }) => void;
      updateTimelineShareData: (config: {
        title: string;
        link: string;
        imgUrl: string;
        success?: () => void;
        fail?: () => void;
      }) => void;
    };
  }
}

const PLATFORMS: { id: SharePlatform; label: Record<Locale, string>; icon: string; color: string }[] = [
  { id: 'wechat', label: { en: 'WeChat', zh: '微信', es: 'WeChat' }, icon: '💬', color: '#07c160' },
  { id: 'weibo', label: { en: 'Weibo', zh: '微博', es: 'Weibo' }, icon: '🔴', color: '#e6162d' },
  { id: 'facebook', label: { en: 'Facebook', zh: 'Facebook', es: 'Facebook' }, icon: '📘', color: '#1877f2' },
  { id: 'twitter', label: { en: 'Twitter/X', zh: 'Twitter/X', es: 'Twitter/X' }, icon: '🐦', color: '#1da1f2' },
  { id: 'copy', label: { en: 'Copy link', zh: '复制链接', es: 'Copiar enlace' }, icon: '🔗', color: '#6b7280' },
];

const copy: Record<Locale, { share: string; copied: string; wechatHint: string; shareSuccess: string; close: string }> = {
  en: {
    share: 'Share',
    copied: 'Link copied!',
    wechatHint: 'Scan the QR code or share within WeChat',
    shareSuccess: 'Shared!',
    close: 'Close',
  },
  zh: {
    share: '分享',
    copied: '链接已复制！',
    wechatHint: '扫描二维码或在微信内分享',
    shareSuccess: '分享成功！',
    close: '关闭',
  },
  es: {
    share: 'Compartir',
    copied: '¡Enlace copiado!',
    wechatHint: 'Escanea el código QR o comparte dentro de WeChat',
    shareSuccess: '¡Compartido!',
    close: 'Cerrar',
  },
};

export function ShareModal({
  isOpen,
  onClose,
  shareUrl,
  title,
  description,
  reportId,
  locale = 'en',
  onShare,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [wechatReady, setWechatReady] = useState(false);
  const t = copy[locale];

  const initWechat = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const isWechat = /MicroMessenger/i.test(navigator.userAgent);
    if (!isWechat) return;

    try {
      const res = await fetch('/api/wechat/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: window.location.href }),
      });

      if (!res.ok) return;

      const config = (await res.json()) as WechatConfig;

      if (!window.wx) {
        const script = document.createElement('script');
        script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
        script.async = true;
        script.onload = () => configureWechat(config);
        document.head.appendChild(script);
      } else {
        configureWechat(config);
      }
    } catch (e) {
      console.error('[ShareModal] Failed to init WeChat:', e);
    }
  }, []);

  const configureWechat = (config: WechatConfig) => {
    if (!window.wx) return;

    window.wx.config({
      debug: false,
      appId: config.appId,
      timestamp: config.timestamp,
      nonceStr: config.nonceStr,
      signature: config.signature,
      jsApiList: config.jsApiList,
    });

    window.wx.ready(() => {
      setWechatReady(true);
    });

    window.wx.error((res) => {
      console.error('[ShareModal] WeChat config error:', res);
    });
  };

  useEffect(() => {
    if (isOpen) {
      initWechat();
    }
  }, [isOpen, initWechat]);

  const handleShare = async (platform: SharePlatform) => {
    const urlWithUtm = appendUtmToUrl(shareUrl, platform, reportId);

    if (platform === 'copy') {
      try {
        await navigator.clipboard.writeText(urlWithUtm);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        const input = document.createElement('input');
        input.value = urlWithUtm;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      onShare?.(platform);
      return;
    }

    if (platform === 'wechat') {
      if (wechatReady && window.wx) {
        const ogImageUrl = `${window.location.origin}/api/og/result?location=${encodeURIComponent(shareUrl)}&headline=${encodeURIComponent(title)}`;

        window.wx.updateAppMessageShareData({
          title,
          desc: description || '',
          link: urlWithUtm,
          imgUrl: ogImageUrl,
        });

        window.wx.updateTimelineShareData({
          title: `${title} - ${description || ''}`,
          link: urlWithUtm,
          imgUrl: ogImageUrl,
        });
      }
      onShare?.(platform);
      return;
    }

    const socialUrl = buildSocialShareUrl(platform, urlWithUtm, title, description);
    if (socialUrl) {
      window.open(socialUrl, '_blank', 'noopener,noreferrer,width=600,height=400');
      onShare?.(platform);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(11,18,32,0.45)]">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight text-brand-navy">{t.share}</h3>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-brand-navy"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {PLATFORMS.map((platform) => (
            <button
              key={platform.id}
              onClick={() => handleShare(platform.id)}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-brand-paper p-4 text-left transition hover:border-zinc-400 hover:bg-zinc-50"
            >
              <span className="text-2xl" aria-hidden>{platform.icon}</span>
              <span className="text-sm font-medium text-brand-navy">
                {platform.label[locale]}
              </span>
            </button>
          ))}
        </div>

        {copied && (
          <div className="mt-4 rounded-lg border border-brand-pine/25 bg-brand-pine/8 p-3 text-center text-sm text-brand-pine">
            {t.copied}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl border border-zinc-300 bg-white py-3 text-sm font-semibold text-brand-navy transition hover:bg-zinc-50"
        >
          {t.close}
        </button>
      </div>
    </div>
  );
}
