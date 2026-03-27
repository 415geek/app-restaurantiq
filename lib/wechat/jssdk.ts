import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/server/supabase-admin';

const WECHAT_API_BASE = 'https://api.weixin.qq.com/cgi-bin';
const TOKEN_TABLE = 'iq_wechat_tokens';

type TokenType = 'access_token' | 'jsapi_ticket';

type WechatTokenRow = {
  id: number;
  token_type: TokenType;
  token_value: string;
  expires_at: string;
};

type JssdkSignature = {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
};

function getWechatConfig() {
  const appId = process.env.WECHAT_APPID?.trim();
  const appSecret = process.env.WECHAT_APPSECRET?.trim();
  
  if (!appId || !appSecret) {
    throw new Error('WECHAT_APPID and WECHAT_APPSECRET must be configured');
  }
  
  return { appId, appSecret };
}

function generateNonceStr(length = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function sha1(str: string): string {
  return createHash('sha1').update(str, 'utf8').digest('hex');
}

async function getCachedToken(tokenType: TokenType): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(TOKEN_TABLE)
    .select('token_value, expires_at')
    .eq('token_type', tokenType)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as WechatTokenRow;
  const expiresAt = new Date(row.expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

  if (expiresAt.getTime() - bufferMs > now.getTime()) {
    return row.token_value;
  }

  return null;
}

async function setCachedToken(tokenType: TokenType, tokenValue: string, expiresInSeconds: number): Promise<void> {
  const sb = supabaseAdmin();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const { error } = await sb
    .from(TOKEN_TABLE)
    .upsert(
      {
        token_type: tokenType,
        token_value: tokenValue,
        expires_at: expiresAt,
      },
      { onConflict: 'token_type' }
    );

  if (error) {
    console.error('[wechat/jssdk] Failed to cache token:', error);
  }
}

async function fetchAccessToken(): Promise<string> {
  const cached = await getCachedToken('access_token');
  if (cached) return cached;

  const { appId, appSecret } = getWechatConfig();
  const url = `${WECHAT_API_BASE}/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;

  const res = await fetch(url);
  const json = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };

  if (json.errcode) {
    throw new Error(`WeChat access_token error: ${json.errcode} - ${json.errmsg}`);
  }

  if (!json.access_token) {
    throw new Error('WeChat returned empty access_token');
  }

  await setCachedToken('access_token', json.access_token, json.expires_in || 7200);
  return json.access_token;
}

async function fetchJsapiTicket(): Promise<string> {
  const cached = await getCachedToken('jsapi_ticket');
  if (cached) return cached;

  const accessToken = await fetchAccessToken();
  const url = `${WECHAT_API_BASE}/ticket/getticket?access_token=${accessToken}&type=jsapi`;

  const res = await fetch(url);
  const json = (await res.json()) as { ticket?: string; expires_in?: number; errcode?: number; errmsg?: string };

  if (json.errcode && json.errcode !== 0) {
    throw new Error(`WeChat jsapi_ticket error: ${json.errcode} - ${json.errmsg}`);
  }

  if (!json.ticket) {
    throw new Error('WeChat returned empty jsapi_ticket');
  }

  await setCachedToken('jsapi_ticket', json.ticket, json.expires_in || 7200);
  return json.ticket;
}

export async function generateJssdkSignature(url: string): Promise<JssdkSignature> {
  const { appId } = getWechatConfig();
  const jsapiTicket = await fetchJsapiTicket();
  const nonceStr = generateNonceStr();
  const timestamp = Math.floor(Date.now() / 1000);

  // Remove hash from URL (WeChat requirement)
  const cleanUrl = url.split('#')[0];

  const signStr = `jsapi_ticket=${jsapiTicket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${cleanUrl}`;
  const signature = sha1(signStr);

  return {
    appId,
    timestamp,
    nonceStr,
    signature,
  };
}

export function isWechatConfigured(): boolean {
  return Boolean(process.env.WECHAT_APPID?.trim() && process.env.WECHAT_APPSECRET?.trim());
}
