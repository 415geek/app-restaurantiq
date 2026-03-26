/** Funnel pages change often; avoid CDN/edge serving stale HTML after deploys. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function IqLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">{children}</div>;
}
