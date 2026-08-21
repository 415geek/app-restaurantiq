'use client';

import { useState } from 'react';

import type { CompetitorMapPin, CompetitorMapTier } from '@/lib/funnel/iq-competitor-map';

type Props = {
  center: { lat: number; lng: number } | null;
  pins: CompetitorMapPin[];
  lang: 'en' | 'zh';
  staticMapUrl?: string | null;
  /**
   * Total named competitors retrieved from market_data (Google ∪ Yelp ∪ BrightData).
   * When 0–2, we render a "data insufficient" panel instead of a near-empty map.
   */
  whitelistTotal?: number;
  /**
   * Set when the post-LLM grounding pass dropped one or more hallucinated names
   * or judged the kept count too low. Triggers the warning banner.
   */
  insufficient?: boolean;
};

const MIN_USEFUL_PINS = 2;

function InsufficientPanel({
  lang,
  whitelistTotal,
}: {
  lang: 'en' | 'zh';
  whitelistTotal?: number;
}) {
  const count = whitelistTotal ?? 0;
  if (lang === 'zh') {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden>
            ⚠️
          </span>
          <div className="space-y-2 text-sm leading-relaxed text-amber-100">
            <p className="font-semibold">竞品数据不足以绘制可信地图</p>
            <p className="text-amber-100/85">
              本次仅检索到 <strong>{count}</strong> 家具名竞品（Google / Yelp / BrightData 合计）。
              报告其他部分仍可参考，但<strong>竞品分布、威胁等级、收入对标</strong>请视为低置信度。
            </p>
            <p className="text-amber-100/75">
              如需精准竞品分析，可在系统设置中接入 Yelp Fusion API 或扩大检索半径后重新生成。
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          ⚠️
        </span>
        <div className="space-y-2 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold">Competitor data is too thin to plot a reliable map</p>
          <p className="text-amber-100/85">
            Only <strong>{count}</strong> named competitor(s) were retrieved (Google / Yelp / BrightData
            combined). Other sections remain useful, but treat the
            <strong> competitor mix, threat levels, and revenue benchmarks </strong>
            as low-confidence.
          </p>
          <p className="text-amber-100/75">
            Enable Yelp Fusion in settings or widen the search radius before regenerating for a high-fidelity
            competitive picture.
          </p>
        </div>
      </div>
    </div>
  );
}

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

export function CompetitorMap({
  center,
  pins,
  lang,
  staticMapUrl,
  whitelistTotal,
  insufficient,
}: Props) {
  // When the Google Static Maps <img> fails (most commonly the API key is HTTP-referrer
  // restricted and 'app.restaurantiq.ai' isn't whitelisted, or the Static Maps API
  // isn't enabled on the project), fall back to the inline SVG so users still see the
  // pin layout instead of a broken image icon.
  const [staticMapFailed, setStaticMapFailed] = useState(false);
  const tooFewPins = pins.length < MIN_USEFUL_PINS;
  const noCenter = !center;
  const showInsufficient = insufficient || tooFewPins || noCenter;

  // No usable map → render the warning panel only.
  if (showInsufficient && noCenter) {
    return (
      <div className="space-y-4">
        <InsufficientPanel lang={lang} whitelistTotal={whitelistTotal} />
      </div>
    );
  }

  const W = 560;
  const H = 320;
  const projected = center ? projectPins(center, pins, W, H) : null;
  const tiersPresent = new Set<CompetitorMapTier>(['site', ...pins.map((p) => p.tier)]);
  const useStatic = staticMapUrl && !staticMapFailed;

  return (
    <div className="space-y-4">
      {showInsufficient && <InsufficientPanel lang={lang} whitelistTotal={whitelistTotal} />}
      {useStatic ? (
        <div className="overflow-hidden rounded-xl border border-zinc-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={staticMapUrl as string}
            alt={lang === 'zh' ? '竞品分布地图' : 'Competitor map'}
            className="h-auto w-full"
            width={640}
            height={360}
            onError={() => setStaticMapFailed(true)}
          />
        </div>
      ) : projected ? (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
            <rect width={W} height={H} fill="#0f172a" />
            <circle
              cx={projected.site.x}
              cy={projected.site.y}
              r={10}
              fill="#34d399"
              stroke="#ecfdf5"
              strokeWidth={2}
            />
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
      ) : null}

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
