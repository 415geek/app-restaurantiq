/** Funnel pages change often; avoid CDN/edge serving stale HTML after deploys. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 思源黑体 for body + 思源宋体 for headlines — the pairing used by Chinese consulting / research reports; system CJK fonts remain the fallback. */
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@700;900&display=swap';

export default function IqLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-navy text-zinc-50 antialiased">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FONTS_HREF} />
      {children}
    </div>
  );
}
