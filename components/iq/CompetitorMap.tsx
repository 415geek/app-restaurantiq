'use client';

import type { CompetitorMapPin, CompetitorMapTier } from '@/lib/funnel/iq-competitor-map';

type Props = {
  center: { lat: number; lng: number };
  pins: CompetitorMapPin[];
  lang: 'en' | 'zh';
  staticMapUrl?: string | null;
};

const TIER_STYLE: Record<CompetitorMapTier, { fill: string; label: { en: string; zh: string } }> = {
  site: { fill: '#34d399', label: { en: 'Your site', zh: '目标址' } },
  direct: { fill: '#f87171', label: { en: 'Direct competitor', zh: '直接竞品' } },
  semi_direct: { fill: '#fb923c', label: { en: 'Semi-direct', zh: '半直接竞品' } },
  substitute: { fill: '#60a5fa', label: { en: 'Substitute', zh: '替代竞品' } },
  traffic: { fill: '#a78bfa', label: { en: 'Traffic competitor', zh: '流量竞品' } },
  other: { fill: '#94a3b8', label: { en: 'Other dining', zh: '其他餐饮' } },
};

function projectPins(
  center: { lat: number; lng: number },
  pins: CompetitorMapPin[],
  width: number,
  height: number,
) {
  const all = [{ lat: center.lat, lng: center.lng }, ...pins.map((p) => ({ lat: p.lat, lng: p.lng }))];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = Math.max((maxLat - minLat) * 0.15, 0.002);
  const padLng = Math.max((maxLng - minLng) * 0.15, 0.002);

  const toX = (lng: number) => ((lng - (minLng - padLng)) / (maxLng - minLng + 2 * padLng)) * (width - 40) + 20;
  const toY = (lat: number) => height - (((lat - (minLat - padLat)) / (maxLat - minLat + 2 * padLat)) * (height - 40) + 20);

  return {
    site: { x: toX(center.lng), y: toY(center.lat) },
    pins: pins.map((p) => ({ ...p, x: toX(p.lng), y: toY(p.lat) })),
  };
}

export function CompetitorMap({ center, pins, lang, staticMapUrl }: Props) {
  const W = 560;
  const H = 320;
  const projected = projectPins(center, pins, W, H);
  const tiersPresent = new Set<CompetitorMapTier>(['site', ...pins.map((p) => p.tier)]);

  return (
    <div className="space-y-4">
      {staticMapUrl ? (
        <div className="overflow-hidden rounded-xl border border-zinc-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={staticMapUrl}
            alt={lang === 'zh' ? '竞品分布地图' : 'Competitor map'}
            className="h-auto w-full"
            width={640}
            height={360}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
            <rect width={W} height={H} fill="#0f172a" />
            <circle cx={projected.site.x} cy={projected.site.y} r={10} fill="#34d399" stroke="#ecfdf5" strokeWidth={2} />
            {projected.pins.map((p) => (
              <circle
                key={`${p.name}-${p.lat}`}
                cx={p.x}
                cy={p.y}
                r={7}
                fill={TIER_STYLE[p.tier].fill}
                stroke="#1e293b"
                strokeWidth={1.5}
                opacity={0.95}
              />
            ))}
          </svg>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
        {Array.from(tiersPresent).map((tier) => (
          <span key={tier} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: TIER_STYLE[tier].fill }}
            />
            {TIER_STYLE[tier].label[lang]}
          </span>
        ))}
      </div>

      {pins.length > 0 && (
        <ul className="grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
          {pins.slice(0, 8).map((p) => (
            <li key={p.name}>
              <span className="font-medium text-zinc-400">{p.name}</span>
              {p.distanceMi != null && (
                <span className="text-zinc-600">
                  {' '}
                  · {p.distanceMi.toFixed(1)} mi
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
