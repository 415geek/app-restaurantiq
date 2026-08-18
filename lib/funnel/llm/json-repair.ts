/**
 * Salvage a JSON object that was cut off mid-generation (max_tokens).
 *
 * A truncated report is far better than no report: the schema parser treats
 * most sections as optional, so closing the open structures recovers every
 * section the model finished writing.
 */
export function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const body = text.slice(start);

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
