/**
 * §4.8.6 覆盖度改变措辞，而不是可见性.
 *
 * The property/permit section is ALWAYS rendered. What changes with coverage is
 * the sentence, never whether the reader is told about exhaust, grease and
 * three-phase power:
 *
 *   E1/E2 present → 该址持有/曾持有餐饮许可，含机械排烟许可记录，改造风险低
 *   only E3       → 前租户为热厨餐饮，该址大概率已具备商用厨房条件，但未经许可记录证实，请现场验房
 *   only E4/none  → 本辖区许可数据未接入，排烟/电力条件无法远程判定，列为签约前必查项
 *
 * The third variant deliberately says nothing about the building's age: the v2
 * report's "1912 年建 → 大概率没有 Type I 排烟罩" is exactly the inference this
 * section forbids. `HOOD_INFERENCE_GUARD` states the rule for the prompt.
 */

import { pick, type Locale } from '@/lib/i18n/locale';
import type { EvidenceLevel, JurisdictionConfidenceInput, PropertyFacts } from './types';
import { strongestEvidence } from './types';

export type JurisdictionCoverageCase = 'permit_record' | 'prior_tenant' | 'not_connected';

export interface JurisdictionConclusion {
  case: JurisdictionCoverageCase;
  /** The customer-facing sentence, in `lang`. */
  text: string;
  /** Strongest evidence actually obtained (null when nothing was). */
  evidence: EvidenceLevel | null;
  /** Pre-lease checklist item — its wording also depends on the evidence level. */
  checklist_item: string;
  /** Internal rule for the prompt; never printed as a finding. */
  guard: string;
}

/** The rule that closes the v2 logic hole. Internal (prompt) text, not a finding. */
export const HOOD_INFERENCE_GUARD: Record<Locale, string> = {
  en: 'Never infer the presence or absence of a Type I hood, grease interceptor or three-phase power from the building\'s year of construction, its residential unit count or any listing description. Only the evidence ladder E1/E2/E3 may support such a statement; otherwise say the data was not retrieved.',
  zh: '禁止用建筑年代、住宅卧室/卫生间数或任何房源描述推断是否有 Type I 排烟罩、隔油池或三相电。只有证据阶梯 E1/E2/E3 可以支撑这类结论；否则一律写「未获取」。',
  es: 'Nunca infiera la presencia o ausencia de una campana Tipo I, un interceptor de grasa o energía trifásica a partir del año de construcción del edificio, del número de unidades residenciales ni de la descripción de un anuncio inmobiliario. Solo la escalera de evidencia E1/E2/E3 puede sustentar tal afirmación; de lo contrario, indique que el dato no se obtuvo.',
};

const TEXT: Record<JurisdictionCoverageCase, Record<Locale, string>> = {
  permit_record: {
    zh: '该址持有/曾持有餐饮许可，含机械排烟许可记录，改造风险低。',
    en: 'This address holds (or has held) a food-facility permit, including a mechanical exhaust permit record — conversion risk is low.',
    es: 'Esta dirección tiene (o tuvo) un permiso de establecimiento de alimentos, con registro de permiso de extracción mecánica: el riesgo de conversión es bajo.',
  },
  prior_tenant: {
    zh: '前租户为热厨餐饮，该址大概率已具备商用厨房条件，但未经许可记录证实，请现场验房。',
    en: 'The prior tenant ran a hot kitchen, so this space very likely already has commercial-kitchen infrastructure — but no permit record confirms it. Inspect the premises on site.',
    es: 'El inquilino anterior operaba una cocina caliente, por lo que este local muy probablemente ya cuenta con infraestructura de cocina comercial, pero ningún registro de permisos lo confirma. Inspeccione el local en persona.',
  },
  not_connected: {
    zh: '本辖区许可数据未接入，排烟/电力条件无法远程判定，列为签约前必查项。',
    en: "This jurisdiction's permit data is not connected, so exhaust and electrical capacity cannot be determined remotely. Treat it as a must-verify item before signing.",
    es: 'Los datos de permisos de esta jurisdicción no están conectados, por lo que la extracción y la capacidad eléctrica no pueden determinarse a distancia. Trátelo como un punto obligatorio de verificación antes de firmar.',
  },
};

/** Default pre-lease checklist item when there is no permit record to verify against. */
const CHECKLIST_BASE: Record<Locale, string> = {
  zh: '索取 DBI 许可记录',
  en: 'Request the building department (DBI) permit records for this address',
  es: 'Solicite al departamento de construcción (DBI) los registros de permisos de esta dirección',
};

/** With an E2 record in hand, the ask changes from "get the records" to "verify the hardware". */
const CHECKLIST_WITH_E2: Record<Locale, string> = {
  zh: '核验该许可对应的 hood 型号与现状是否仍在',
  en: 'Verify that the hood model on that permit is still installed and in working order',
  es: 'Verifique que el modelo de campana indicado en ese permiso siga instalado y en funcionamiento',
};

/** Which of the three §4.8.6 cases the facts fall into. */
export function jurisdictionCoverageCase(facts: PropertyFacts): JurisdictionCoverageCase {
  const strongest = strongestEvidence(facts);
  if (strongest === 'E1' || strongest === 'E2') return 'permit_record';
  if (strongest === 'E3') return 'prior_tenant';
  return 'not_connected';
}

/** True when an E2 mechanical/hood permit record was actually retrieved. */
export function hasHoodPermitRecord(facts: PropertyFacts): boolean {
  return facts.hood_permit_found?.value === true && facts.hood_permit_found.evidence === 'E2';
}

/** §4.8.6 — the trilingual conclusion plus the matching pre-lease checklist item. */
export function jurisdictionConclusion(facts: PropertyFacts, lang: Locale): JurisdictionConclusion {
  const kind = jurisdictionCoverageCase(facts);
  return {
    case: kind,
    text: pick(lang, TEXT[kind]),
    evidence: strongestEvidence(facts),
    checklist_item: pick(lang, hasHoodPermitRecord(facts) ? CHECKLIST_WITH_E2 : CHECKLIST_BASE),
    guard: HOOD_INFERENCE_GUARD[lang],
  };
}

/** All three variants at once — handy for snapshot/QA and for multi-language packs. */
export function jurisdictionConclusionAllLocales(facts: PropertyFacts): Record<Locale, JurisdictionConclusion> {
  return {
    en: jurisdictionConclusion(facts, 'en'),
    zh: jurisdictionConclusion(facts, 'zh'),
    es: jurisdictionConclusion(facts, 'es'),
  };
}

// ---------------------------------------------------------------------------
// data_confidence input (§4.8.6 last line)
// ---------------------------------------------------------------------------

const ACQUIRED: Record<keyof PropertyFacts, Record<Locale, string>> = {
  prior_food_facility: { zh: '该址历史餐饮用途', en: 'prior food use at this address', es: 'uso previo de alimentos en la dirección' },
  hood_permit_found: { zh: '机械排烟/隔油许可记录', en: 'mechanical exhaust / grease permit record', es: 'registro de permiso de extracción / grasa' },
  year_built: { zh: '建成年份（仅背景）', en: 'year built (context only)', es: 'año de construcción (solo contexto)' },
  use_code: { zh: '评估局用途代码', en: 'assessor use code', es: 'código de uso del tasador' },
};

/**
 * Feeds `jurisdiction_coverage` into the report's `data_confidence` input.
 * A connected jurisdiction with real permit records raises confidence; a
 * jurisdiction that is not wired up lowers it, so the report never looks more
 * certain about the box than it is.
 */
export function jurisdictionConfidenceInput(
  facts: PropertyFacts,
  coverage: number,
  lang: Locale,
  gapReasons?: Partial<Record<keyof PropertyFacts, string | null>>,
): JurisdictionConfidenceInput {
  const kind = jurisdictionCoverageCase(facts);
  const cov = Number.isFinite(coverage) ? Math.min(1, Math.max(0, coverage)) : 0;
  const delta = kind === 'permit_record' ? Math.round(4 + 6 * cov) : kind === 'prior_tenant' ? 2 : -8;

  const acquired: string[] = [];
  const missing: string[] = [];
  (Object.keys(ACQUIRED) as Array<keyof PropertyFacts>).forEach((k) => {
    const label = pick(lang, ACQUIRED[k]);
    if (facts[k]) acquired.push(`${label} [${facts[k]!.evidence}]`);
    else {
      const why = gapReasons?.[k];
      missing.push(why ? `${label}（${why}）` : label);
    }
  });

  return {
    jurisdiction_coverage: cov,
    evidence_level: strongestEvidence(facts),
    confidence_delta_pct: delta,
    acquired_data: acquired,
    missing_data: missing,
  };
}
