/**
 * SourceChip — provenance chips that replace the `[src:...]` bracket tags in
 * the printed report (研发提示词 Phase 5.1). Five kinds only; labels come from
 * the report-language dictionary (render/i18n.ts).
 */
import type { ReactNode } from 'react';
import { Calculator, Database, Globe, Landmark, PenLine } from 'lucide-react';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import type { ReportModel, SourceRow } from '../model/schema';
import { sourceShort } from './format';
import { strings } from './i18n';

export type SourceKind = 'official' | 'platform' | 'user' | 'model' | 'web';

/** Chinese chip-kind labels (legacy export); use `strings(lang).sourceKind` for the report language. */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = strings('zh').sourceKind;

/** Data-source id (D1..D12) → chip kind. Mirrors lib/iq/data/types.ts DataSourceId comments. */
const KIND_BY_SOURCE_ID: Record<string, SourceKind> = {
  D1: 'official', // Census geocoder
  D2: 'official', // ACS
  D3: 'official', // LODES
  D4: 'platform', // Mapbox isochrones
  D5: 'platform', // Overture
  D6: 'platform', // Google Places
  D7: 'platform', // review-count snapshots
  D8: 'web', // rent comps (search)
  D9: 'official', // GTFS / AADT
  D10: 'official', // BLS CEX
  D11: 'web', // development pipeline (search)
  D12: 'user', // user inputs
};

export function sourceKindOf(row: Pick<SourceRow, 'id' | 'source'>): SourceKind {
  const byId = KIND_BY_SOURCE_ID[row.id];
  if (byId) return byId;
  const s = row.source.toLowerCase();
  if (/census|acs|lodes|lehd|bls|gtfs|caltrans|dot\b/.test(s)) return 'official';
  if (/tavily|search|web/.test(s)) return 'web';
  if (/user/.test(s)) return 'user';
  if (/overture|google|mapbox|supabase|snapshot/.test(s)) return 'platform';
  return 'model';
}

const ICON: Record<SourceKind, (props: { size: number; strokeWidth: number; className?: string; 'aria-hidden'?: boolean }) => ReactNode> = {
  official: Landmark,
  platform: Database,
  user: PenLine,
  model: Calculator,
  web: Globe,
};

export function SourceChip({ kind, label, status, lang = DEFAULT_LOCALE }: { kind: SourceKind; label?: string; status?: SourceRow['status']; lang?: Locale }) {
  const S = strings(lang);
  const Icon = ICON[kind];
  const suffix = status && status !== 'ok' ? S.sourceStatus[status] : '';
  return (
    <span className={`chip chip-${kind}`} data-kind={kind}>
      <Icon size={10} strokeWidth={1.75} className="chip-icon" aria-hidden />
      <span className="chip-kind">{S.sourceKind[kind]}</span>
      {label ? <span className="chip-label">· {label}</span> : null}
      {suffix ? <span className="chip-status">· {suffix}</span> : null}
    </span>
  );
}

/** Chips for the given data-source ids (looked up in model.sources so status is real), plus optional model-estimate chips. */
export function SourceChips({ model, ids, model_labels = [], extra = [], lang = DEFAULT_LOCALE }: { model: ReportModel; ids: string[]; model_labels?: string[]; extra?: Array<{ kind: SourceKind; label: string }>; lang?: Locale }) {
  const rows = ids.map((id) => model.sources.find((s) => s.id === id)).filter((r): r is SourceRow => Boolean(r));
  return (
    <div className="chips">
      {rows.map((r) => (
        <SourceChip key={r.id} kind={sourceKindOf(r)} label={sourceShort(r, lang)} status={r.status} lang={lang} />
      ))}
      {extra.map((e, i) => (
        <SourceChip key={`x${i}`} kind={e.kind} label={e.label} lang={lang} />
      ))}
      {model_labels.map((l, i) => (
        <SourceChip key={`m${i}`} kind="model" label={l} lang={lang} />
      ))}
    </div>
  );
}
