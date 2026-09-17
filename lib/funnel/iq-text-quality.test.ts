import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTextQuality, scanTextQuality, scrubCorruptedSentences } from './iq-text-quality';

test('clean Chinese report prose passes', () => {
  const r = scanTextQuality('本址月租 $5,900，保本线约 $51,937，占用成本比 9.1%，建议签约前核实排烟条件。');
  assert.equal(r.ok, true);
  assert.equal(r.corrupt, 0);
  assert.equal(formatTextQuality(r), 'text-quality: clean');
});

test('Latin glued inside a Han run is corruption (门店née点计数器)', () => {
  const r = scanTextQuality('门店née点计数器显示周末客流更高。');
  assert.equal(r.ok, false);
  const f = r.findings.find((x) => x.kind === 'latin_in_han');
  assert.ok(f, 'latin_in_han finding');
  assert.equal(f!.text, 'née');
  assert.equal(f!.severity, 'corrupt');
});

test('allow-listed inline Latin is not flagged', () => {
  for (const s of ['接入POS系统后可核对日结', '导出PDF给房东', '该址判定为GO级别']) {
    assert.equal(scanTextQuality(s).ok, true, s);
  }
});

test('an out-of-vocabulary Han character is a warning, not a failure (礏盒装)', () => {
  const r = scanTextQuality('推出礏盒装伴手礼。');
  assert.equal(r.ok, true, 'suspect findings never fail the text');
  const f = r.findings.find((x) => x.kind === 'unknown_han');
  assert.ok(f, 'unknown_han finding');
  assert.equal(f!.text, '礏');
  assert.equal(f!.severity, 'suspect');
});

test('characters from the report context are legitimate', () => {
  const name = '犇记烧腊';
  const withoutContext = scanTextQuality(`竞品${name}主打宴席。`);
  assert.ok(withoutContext.findings.some((f) => f.kind === 'unknown_han'), 'flagged without context');
  const withContext = scanTextQuality(`竞品${name}主打宴席。`, { context: `竞品名单：${name}` });
  assert.equal(withContext.findings.filter((f) => f.kind === 'unknown_han').length, 0);
});

test('structural damage: replacement char, private use, CJK extension, control char', () => {
  for (const [s, kind] of [
    ['保本线为 � 元', 'replacement_char'],
    ['价位  档', 'private_use'],
    ['该址㐀邻近地铁', 'cjk_extension'],
    ['分析完成', 'control_char'],
  ] as const) {
    const r = scanTextQuality(s);
    assert.equal(r.ok, false, s);
    assert.ok(r.findings.some((f) => f.kind === kind), `${kind} in ${JSON.stringify(s)}`);
  }
});

test('scrub removes only the damaged sentence', () => {
  const text = '第一句是干净的。门店née点计数器坏了。第三句也是干净的。';
  const { text: out, removed } = scrubCorruptedSentences(text);
  assert.equal(removed, 1);
  assert.equal(out, '第一句是干净的。第三句也是干净的。');
  assert.equal(scanTextQuality(out).ok, true);
});

test('scrub keeps a rare-but-legitimate character', () => {
  const text = '推出礏盒装伴手礼。第二句正常。';
  const { text: out, removed } = scrubCorruptedSentences(text);
  assert.equal(removed, 0);
  assert.equal(out, text);
});

test('the report sanitizer drops corrupted prose and keeps everything else', async () => {
  const { stripInternalIqReportFields } = await import('./iq-report-sanitize');
  const report = {
    executive_summary: '本址适合做葡挞。门店née点计数器坏了。周末上午客流最高。',
    competitors: [{ name: '犇记烧腊', note: '同街兼售蛋挞，评论 1,771 条，值得对标。' }],
    _generation_model: 'some-model',
  } as never;
  const out = stripInternalIqReportFields(report) as unknown as {
    executive_summary: string;
    competitors: { name: string; note: string }[];
    _generation_model?: string;
  };
  assert.equal(out.executive_summary, '本址适合做葡挞。周末上午客流最高。');
  assert.equal(out.competitors[0].name, '犇记烧腊', 'a rare character in a real name survives');
  assert.equal(out.competitors[0].note, '同街兼售蛋挞，评论 1,771 条，值得对标。');
  assert.equal(out._generation_model, undefined);
});
