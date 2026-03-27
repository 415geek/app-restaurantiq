export type UtmParams = {
  utm_source: string;
  utm_medium: string;
  utm_campaign?: string;
  utm_content?: string;
};

export type SharePlatform = 'wechat' | 'weibo' | 'facebook' | 'twitter' | 'linkedin' | 'copy';

const PLATFORM_SOURCE_MAP: Record<SharePlatform, string> = {
  wechat: 'wechat',
  weibo: 'weibo',
  facebook: 'facebook',
  twitter: 'twitter',
  linkedin: 'linkedin',
  copy: 'copy',
};

export function buildUtmParams(platform: SharePlatform, reportId?: string): UtmParams {
  return {
    utm_source: PLATFORM_SOURCE_MAP[platform],
    utm_medium: 'share',
    utm_campaign: 'result_share',
    utm_content: reportId,
  };
}

export function appendUtmToUrl(baseUrl: string, platform: SharePlatform, reportId?: string): string {
  const utm = buildUtmParams(platform, reportId);
  const url = new URL(baseUrl);

  url.searchParams.set('utm_source', utm.utm_source);
  url.searchParams.set('utm_medium', utm.utm_medium);
  if (utm.utm_campaign) url.searchParams.set('utm_campaign', utm.utm_campaign);
  if (utm.utm_content) url.searchParams.set('utm_content', utm.utm_content);

  return url.toString();
}

export function parseUtmFromUrl(url: string): Partial<UtmParams> {
  try {
    const parsed = new URL(url);
    return {
      utm_source: parsed.searchParams.get('utm_source') || undefined,
      utm_medium: parsed.searchParams.get('utm_medium') || undefined,
      utm_campaign: parsed.searchParams.get('utm_campaign') || undefined,
      utm_content: parsed.searchParams.get('utm_content') || undefined,
    };
  } catch {
    return {};
  }
}

export function getShareUrl(
  baseUrl: string,
  platform: SharePlatform,
  params: {
    reportId?: string;
    location?: string;
    verdict?: string;
    lang?: string;
  }
): string {
  const url = new URL(baseUrl);

  if (params.location) url.searchParams.set('location', params.location);
  if (params.verdict) url.searchParams.set('verdict', params.verdict);
  if (params.lang) url.searchParams.set('lang', params.lang);

  return appendUtmToUrl(url.toString(), platform, params.reportId);
}

export function buildSocialShareUrl(
  platform: SharePlatform,
  shareUrl: string,
  title: string,
  description?: string
): string | null {
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);
  const encodedDesc = encodeURIComponent(description || '');

  switch (platform) {
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedTitle}`;
    case 'twitter':
      return `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
    case 'weibo':
      return `https://service.weibo.com/share/share.php?url=${encodedUrl}&title=${encodedTitle}&pic=`;
    case 'wechat':
    case 'copy':
      return null; // Handled differently
    default:
      return null;
  }
}
