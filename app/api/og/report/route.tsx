import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const location = searchParams.get('location') || '';
    const confidence = searchParams.get('confidence') || 'medium';
    const lang = searchParams.get('lang') || 'en';

    const confidenceColors: Record<string, string> = {
      high: '#10b981',
      medium: '#f59e0b',
      low: '#ef4444',
    };

    const confidenceLabels: Record<string, Record<string, string>> = {
      en: { high: 'High Confidence', medium: 'Medium Confidence', low: 'Low Confidence' },
      zh: { high: '高置信度', medium: '中等置信度', low: '低置信度' },
    };

    const color = confidenceColors[confidence] || confidenceColors.medium;
    const label = confidenceLabels[lang]?.[confidence] || confidenceLabels.en[confidence];

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
                backgroundColor: '#1f2937',
                border: '2px solid #10b981',
                color: '#10b981',
                padding: '12px 24px',
                borderRadius: '12px',
                fontSize: '18px',
                fontWeight: 600,
              }}
            >
              ✓ {lang === 'zh' ? '完整报告' : 'Full Report'}
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
                color: '#ffffff',
                fontSize: '56px',
                fontWeight: 700,
                lineHeight: 1.2,
                marginBottom: '24px',
              }}
            >
              {lang === 'zh' ? '选址决策报告' : 'Location Decision Report'}
            </div>
            
            <div
              style={{
                display: 'flex',
                color: '#9ca3af',
                fontSize: '28px',
                marginBottom: '32px',
              }}
            >
              {location ? `📍 ${location.slice(0, 50)}${location.length > 50 ? '...' : ''}` : ''}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  backgroundColor: color,
                }}
              />
              <div style={{ display: 'flex', color: '#9ca3af', fontSize: '24px' }}>
                {label}
              </div>
            </div>
          </div>

          {/* Features */}
          <div
            style={{
              display: 'flex',
              gap: '32px',
              marginBottom: '32px',
            }}
          >
            {[
              lang === 'zh' ? '收入预估' : 'Revenue Estimate',
              lang === 'zh' ? '风险分析' : 'Risk Analysis',
              lang === 'zh' ? '行动计划' : 'Action Plan',
            ].map((feature, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#6b7280',
                  fontSize: '18px',
                }}
              >
                ✓ {feature}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: '1px solid #374151',
              paddingTop: '24px',
            }}
          >
            <div style={{ display: 'flex', color: '#6b7280', fontSize: '18px' }}>
              {lang === 'zh' ? '由 AI 生成的完整选址分析' : 'Complete AI-Powered Location Analysis'}
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
    console.error('[api/og/report]', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
