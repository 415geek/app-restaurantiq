import { NextResponse } from 'next/server';
import { generateJssdkSignature, isWechatConfigured } from '@/lib/wechat/jssdk';

export const runtime = 'nodejs';

const ALLOWED_DOMAINS = [
  'app.restaurantiq.ai',
  'restaurantiq.ai',
  'localhost:3000',
  'localhost',
];

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    if (!isWechatConfigured()) {
      return NextResponse.json(
        { error: 'WeChat is not configured' },
        { status: 503 }
      );
    }

    const body = (await req.json()) as { url?: string };
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json(
        { error: 'Missing url parameter' },
        { status: 400 }
      );
    }

    if (!isAllowedUrl(url)) {
      return NextResponse.json(
        { error: 'URL domain is not in the allowed list' },
        { status: 403 }
      );
    }

    const signature = await generateJssdkSignature(url);

    return NextResponse.json({
      ...signature,
      jsApiList: [
        'updateAppMessageShareData',
        'updateTimelineShareData',
        'onMenuShareAppMessage',
        'onMenuShareTimeline',
      ],
    });
  } catch (e) {
    console.error('[api/wechat/sign]', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'Failed to generate signature', detail: message.slice(0, 200) },
      { status: 500 }
    );
  }
}
