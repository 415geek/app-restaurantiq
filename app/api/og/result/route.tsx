import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const VERDICT_COLORS: Record<string, { bg: string; text: string; emoji: string }> = {
  go: { bg: '#10b981', text: '#ffffff', emoji: '🟢' },
  caution: { bg: '#f59e0b', text: '#000000', emoji: '🟡' },
  no: { bg: '#ef4444', text: '#ffffff', emoji: '🔴' },
};

const VERDICT_LABELS: Record<string, Record<string, string>> = {
  en: { go: 'GO', caution: 'CAUTION', no: 'NO-GO' },
  zh: { go: '可行', caution: '谨慎', no: '不建议' },
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const verdict = searchParams.get('verdict') || 'caution';
    const headline = searchParams.get('headline') || 'Location Analysis';
    const location = searchParams.get('location') || '';
    const lang = searchParams.get('lang') || 'en';

    const colors = VERDICT_COLORS[verdict] || VERDICT_COLORS.caution;
    const label = VERDICT_LABELS[lang]?.[verdict] || VERDICT_LABELS.en[verdict] || 'CAUTION';

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#0a0a0a',
            padding: '60px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '40px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                color: '#ffffff',
                fontSize: '24px',
                fontWeight: 600,
              }}
            >
              🍽️ RestaurantIQ
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: colors.bg,
                color: colors.text,
                padding: '12px 24px',
                borderRadius: '12px',
                fontSize: '20px',
                fontWeight: 700,
              }}
            >
              {colors.emoji} {label}
            </div>
          </div>

          {/* Main content */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                color: '#9ca3af',
                fontSize: '24px',
                marginBottom: '16px',
              }}
            >
              {location ? `📍 ${location.slice(0, 60)}${location.length > 60 ? '...' : ''}` : ''}
            </div>
            <div
              style={{
                display: 'flex',
                color: '#ffffff',
                fontSize: '48px',
                fontWeight: 700,
                lineHeight: 1.2,
                maxWidth: '900px',
              }}
            >
              {headline.slice(0, 100)}{headline.length > 100 ? '...' : ''}
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: '1px solid #374151',
              paddingTop: '24px',
              marginTop: 'auto',
            }}
          >
            <div style={{ display: 'flex', color: '#6b7280', fontSize: '18px' }}>
              {lang === 'zh' ? 'AI 选址分析报告' : 'AI Location Analysis Report'}
            </div>
            <div style={{ display: 'flex', color: '#6b7280', fontSize: '18px' }}>
              app.restaurantiq.ai
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      }
    );
  } catch (e) {
    console.error('[api/og/result]', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
