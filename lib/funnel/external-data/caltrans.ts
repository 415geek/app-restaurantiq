/**
 * Caltrans Traffic Volume (AADT) API Integration
 * 
 * Data source: California Department of Transportation
 * API: ArcGIS REST Feature Service
 * Coverage: California State Highways only (not local/city streets)
 * 
 * @see https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0
 */
import { DEFAULT_LOCALE, type Locale, pick } from '@/lib/i18n/locale';

const CALTRANS_AADT_BASE_URL =
  'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0/query';

export interface CaltransAADTResult {
  routeNumber: string;
  routeName: string;
  county: string;
  aadt: number; // Annual Average Daily Traffic
  peakHour: number;
  postmile: number;
  year: number;
  latitude: number;
  longitude: number;
}

export interface CaltransQueryResponse {
  features: Array<{
    attributes: {
      ROUTE: string;
      ROUTE_NAME?: string;
      COUNTY: string;
      AADT: number;
      PEAK_HR: number;
      POSTMILE: number;
      DATA_YEAR: number;
    };
    geometry?: {
      x: number;
      y: number;
    };
  }>;
}

/**
 * Query Caltrans AADT data by geographic location (lat/lng + radius)
 * Note: Only returns data for California State Highways
 */
export async function fetchCaltransTrafficByLocation(
  lat: number,
  lng: number,
  radiusMiles: number = 2
): Promise<CaltransAADTResult[]> {
  const radiusMeters = radiusMiles * 1609.34;
  
  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({
      x: lng,
      y: lat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    distance: radiusMeters.toString(),
    units: 'esriSRUnit_Meter',
    outFields: 'ROUTE,ROUTE_NAME,COUNTY,AADT,PEAK_HR,POSTMILE,DATA_YEAR',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  try {
    const response = await fetch(`${CALTRANS_AADT_BASE_URL}?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn('[caltrans] API error:', response.status);
      return [];
    }

    const data = (await response.json()) as CaltransQueryResponse;
    
    if (!data.features?.length) {
      console.log('[caltrans] No state highway data found within', radiusMiles, 'miles');
      return [];
    }

    return data.features.map((f) => ({
      routeNumber: f.attributes.ROUTE || '',
      routeName: f.attributes.ROUTE_NAME || `CA-${f.attributes.ROUTE}`,
      county: f.attributes.COUNTY || '',
      aadt: f.attributes.AADT || 0,
      peakHour: f.attributes.PEAK_HR || 0,
      postmile: f.attributes.POSTMILE || 0,
      year: f.attributes.DATA_YEAR || 0,
      latitude: f.geometry?.y || lat,
      longitude: f.geometry?.x || lng,
    }));
  } catch (e) {
    console.warn('[caltrans] fetch error:', e);
    return [];
  }
}

/**
 * Query Caltrans AADT data by route number (e.g., "101", "280", "1")
 */
export async function fetchCaltransTrafficByRoute(
  routeNumber: string,
  county?: string
): Promise<CaltransAADTResult[]> {
  let where = `ROUTE = '${routeNumber}'`;
  if (county) {
    where += ` AND COUNTY = '${county.toUpperCase()}'`;
  }

  const params = new URLSearchParams({
    where,
    outFields: 'ROUTE,ROUTE_NAME,COUNTY,AADT,PEAK_HR,POSTMILE,DATA_YEAR',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultRecordCount: '100',
  });

  try {
    const response = await fetch(`${CALTRANS_AADT_BASE_URL}?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn('[caltrans] API error:', response.status);
      return [];
    }

    const data = (await response.json()) as CaltransQueryResponse;
    
    return (data.features || []).map((f) => ({
      routeNumber: f.attributes.ROUTE || routeNumber,
      routeName: f.attributes.ROUTE_NAME || `CA-${routeNumber}`,
      county: f.attributes.COUNTY || '',
      aadt: f.attributes.AADT || 0,
      peakHour: f.attributes.PEAK_HR || 0,
      postmile: f.attributes.POSTMILE || 0,
      year: f.attributes.DATA_YEAR || 0,
      latitude: f.geometry?.y || 0,
      longitude: f.geometry?.x || 0,
    }));
  } catch (e) {
    console.warn('[caltrans] fetch error:', e);
    return [];
  }
}

/**
 * Format Caltrans data for inclusion in market data anchors
 */
export function formatCaltransForAnchors(
  results: CaltransAADTResult[],
  lang: Locale = DEFAULT_LOCALE,
): string {
  if (!results.length) return '';

  const lines: string[] = [];

  lines.push(
    pick(lang, {
      en: '### Traffic Volume Data [Caltrans]',
      zh: '### 交通流量数据 [Caltrans]',
      es: '### Datos de volumen de tráfico [Caltrans]',
    }),
  );
  lines.push(
    pick(lang, {
      en: '> Source: California DOT Annual Average Daily Traffic',
      zh: '> 数据来源: 加州交通局年均日交通量(AADT)',
      es: '> Fuente: Tráfico diario promedio anual del Departamento de Transporte de California',
    }),
  );
  lines.push('');

  const sorted = [...results].sort((a, b) => b.aadt - a.aadt);
  const top = sorted.slice(0, 5);

  top.forEach((r) => {
    const routeLabel = r.routeName || `CA-${r.routeNumber}`;
    const aadt = r.aadt.toLocaleString('en-US');
    lines.push(
      pick(lang, {
        en: `- **${routeLabel}** (${r.county} County): ${aadt} vehicles/day [${r.year} data]`,
        zh: `- **${routeLabel}** (${r.county}县): 日均${aadt}辆 [${r.year}年数据]`,
        es: `- **${routeLabel}** (condado de ${r.county}): ${aadt} vehículos/día [datos de ${r.year}]`,
      }),
    );
  });

  return lines.join('\n');
}
