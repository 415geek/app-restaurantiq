/**
 * Serialize catch/reject values for API responses and logs.
 * Avoids the useless literal "[object Object]" from String(plainObject) or new Error(object).
 */
export function unknownErrorMessage(e: unknown, maxLen = 500): string {
  if (e instanceof Error) {
    let m = e.message;
    if (m === '[object Object]' || m === '') {
      if (e.cause !== undefined) {
        return unknownErrorMessage(e.cause, maxLen);
      }
      const ext = e as Error & { details?: unknown; code?: unknown };
      try {
        const blob = JSON.stringify({ name: e.name, details: ext.details, code: ext.code });
        m = blob !== '{}' ? blob : e.name || 'Error';
      } catch {
        m = e.name || 'Error';
      }
    }
    return m.slice(0, maxLen);
  }
  if (typeof e === 'string') {
    return e.slice(0, maxLen);
  }
  if (e == null) {
    return String(e).slice(0, maxLen);
  }
  try {
    const s = JSON.stringify(e);
    if (s && s !== '{}') {
      return s.slice(0, maxLen);
    }
  } catch {
    /* fall through */
  }
  const fallback = String(e);
  if (fallback !== '[object Object]') {
    return fallback.slice(0, maxLen);
  }
  return 'Unknown error';
}
