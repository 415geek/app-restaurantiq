/**
 * Salvage a JSON object that was cut off mid-generation (max_tokens).
 *
 * A truncated report is far better than no report: the schema parser treats
 * most sections as optional, so closing the open structures recovers every
 * section the model finished writing.
 */
/**
 * Escape raw control characters that appear *inside* string literals.
 *
 * A literal newline or tab in a JSON string is invalid, and models emit them
 * regularly when writing prose — especially multi-paragraph CJK content. The
 * document is otherwise complete and balanced, so bracket-closing repair does
 * nothing for it; this is the transformation that actually recovers it.
 */
export function sanitizeJsonControlChars(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch < ' ') out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      else out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

export function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const body = sanitizeJsonControlChars(text.slice(start));

  // A balanced document that still would not parse is usually malformed rather
  // than cut short — raw control characters inside strings being the common
  // case. Try the sanitized text as-is before any structural surgery, and also
  // trimmed to its last closing brace: the plain parser strips markdown fences
  // by slicing to that brace, but it cannot also fix control characters, so
  // fenced output containing a newline fails both paths unless combined here.
  const lastBrace = body.lastIndexOf('}');
  for (const candidate of lastBrace > 0 ? [body, body.slice(0, lastBrace + 1)] : [body]) {
    try {
      const direct = JSON.parse(candidate) as unknown;
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
        return direct as Record<string, unknown>;
      }
    } catch {
      /* fall through to structural repair */
    }
  }

  // Scan once to learn the open-structure stack and whether we ended in a string.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (stack.length === 0 && !inString) return null; // not truncated — nothing to repair

  const close = (s: string, openInString: boolean, openStack: string[]): string =>
    s + (openInString ? '"' : '') + [...openStack].reverse().join('');

  // First attempt: close what is open as-is.
  const attempts: string[] = [close(body, inString, stack)];

  // Then progressively drop the trailing (incomplete) member and retry.
  let candidate = body;
  for (let i = 0; i < 6; i++) {
    const cut = Math.max(candidate.lastIndexOf(','), candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (cut <= 0) break;
    candidate = candidate.slice(0, candidate[cut] === ',' ? cut : cut + 1);
    const s: string[] = [];
    let str = false;
    let esc = false;
    for (const ch of candidate) {
      if (str) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') str = false;
        continue;
      }
      if (ch === '"') str = true;
      else if (ch === '{') s.push('}');
      else if (ch === '[') s.push(']');
      else if (ch === '}' || ch === ']') s.pop();
    }
    attempts.push(close(candidate, str, s));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try the next, shorter candidate */
    }
  }
  return null;
}
