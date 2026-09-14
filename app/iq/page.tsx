'use client';

/**
 * IQ funnel landing (app.restaurantiq.ai/).
 *
 * Light, product-led layout in the Owner.com / DoorDash idiom: a white canvas,
 * one bold headline, an address "search" card as the single hero action, then
 * how-it-works → what's inside →
 * sample numbers → pricing → audiences → FAQ → account footer. All copy is
 * bilingual; the sample block uses the golden Millbrae fixture (synthetic
 * inputs, real public data) — never a customer's report.
 */
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Locale = 'en' | 'zh';

const PRICE_USD = process.env.NEXT_PUBLIC_STRIPE_PRICE_USD?.trim() || '19';

type Copy = {
  nav: { features: string; sample: string; pricing: string; faq: string; signIn: string; cta: string };
  hero: { eyebrow: string; title: string; headlines: string[]; subtitle: string; address: string; cuisine: string; rent: string; sqft: string; more: string; less: string; cta: string; trust: string[] };
  how: { title: string; steps: Array<{ n: string; title: string; body: string }> };
  inside: { title: string; sub: string; items: Array<{ title: string; body: string }> };
  sample: { eyebrow: string; title: string; body: string; verdict: string; rows: Array<{ label: string; value: string; note?: string }>; foot: string };
  pricing: { title: string; sub: string; free: { name: string; price: string; items: string[]; cta: string }; pro: { name: string; price: string; unit: string; items: string[]; cta: string; badge: string } };
  audiences: { title: string; items: Array<{ title: string; body: string }> };
  faq: { title: string; items: Array<{ q: string; a: string }> };
  account: { title: string; body: string; signIn: string; register: string };
  footer: { disclaimer: string; sources: string };
};

const COPY: Record<Locale, Copy> = {
  zh: {
    nav: { features: '报告里有什么', sample: '报告样例', pricing: '价格', faq: '常见问题', signIn: '登录', cta: '免费测算' },
    hero: {
      eyebrow: '餐饮选址风险审计 · 面向美国中餐老板',
      title: '签 lease 前，先通过数据了解该商圈是否适合',
      headlines: [
        '签 lease 前，先通过数据了解该商圈是否适合',
        '开店之前，先看清这个商圈能不能养活一家店',
        '别凭感觉签租约，用数据算清这个铺位的胜算',
        '附近多少华人家庭、几家同行，60 秒看清',
        '这个铺位每月要做多少才保本？签约前先算',
        '好位置用数据说话，坏位置提前劝退',
      ],
      subtitle: '输入地址和菜系，60 秒看到：附近有多少华人家庭、同菜系竞品几家、每月要做到多少营收才保本。数据来自美国人口普查和公开地图，每个数字都能溯源。',
      address: '餐厅地址，例如 1711 El Camino Real, Millbrae, CA',
      cuisine: '菜系或业态，例如：湘菜、港式茶餐厅、火锅、奶茶',
      rent: '预计月租金 USD',
      sqft: '面积 sqft',
      more: '补充租金和面积（选填，财务更准）',
      less: '收起',
      cta: '免费生成风险评分',
      trust: ['60 秒出结论', '美国人口普查 · Google 地图 · 公开数据', '免费版不需要注册'],
    },
    how: {
      title: '三步，从地址到结论',
      steps: [
        { n: '1', title: '输入地址和菜系', body: '租金、面积、座位数可以先不填；填了财务部分会更准。' },
        { n: '2', title: '免费看结论摘要', body: '综合评分、判定（可做 / 有条件 / 不建议）和最要紧的三条洞察，60 秒内给出。' },
        { n: '3', title: '需要时解锁完整报告', body: '16 页专业版：商圈、竞品、需求、保本线、风险与签约清单，PDF 可下载可打印。' },
      ],
    },
    inside: {
      title: '报告里有什么',
      sub: '每一页只回答老板会问的一个问题，白话写，数字有出处。',
      items: [
        { title: '真实地图商圈', body: '步行 10 分钟、开车 5 / 10 / 15 分钟四个范围画在真实地图上，人口、家庭、华人占比逐层给出。' },
        { title: '竞品逐家对标', body: '同菜系竞品一家一张卡：距离、Google 评分与评论数、价位、客流等级、会分走你多少客流。' },
        { title: '需求与保本线', body: '模型预计每月能拿到的需求，对比这个铺位的保本线，告诉你差多少、靠什么补。' },
        { title: '六维评分与判定', body: '需求、竞争、租金、客群、可达、集聚六项打分，一个总分，一个明确的判定。' },
        { title: '风险与签约清单', body: '概率 × 影响的风险登记，签约前必须谈下来的条件，90 天开业计划。' },
        { title: '每个数字可溯源', body: '数据来源页列出每项数据的机构、更新日期和许可；拿不到的数据写「未获取」，不编。' },
      ],
    },
    sample: {
      eyebrow: '报告样例 · 湘菜 @ Millbrae, CA',
      title: '这家店，我们劝退了',
      body: '同样的地址，换成粤菜 / 烧腊评分 79 分「可做」。报告不只说能不能做，还告诉你更适合做什么。',
      verdict: '不建议 · NO GO',
      rows: [
        { label: '综合评分', value: '43.3 / 100', note: '≥ 70 可做，55–69 有条件可做' },
        { label: '需求覆盖率', value: '22%', note: '预计月需求 ÷ 保本线，≥ 100% 才够保本' },
        { label: '租金占预计营收', value: '55%', note: '警戒线 10%' },
        { label: '保本线', value: '$139,280 / 月', note: '固定成本 ÷ 边际贡献率' },
        { label: '同菜系竞品 · 其他中餐', value: '4 家 · 25 家', note: '开车 10 分钟范围内' },
        { label: '数据完整度', value: '85 / 100' },
      ],
      foot: '样例使用公开数据与假设输入（月租 $17,000、2,500 sqft），不代表任何客户报告。',
    },
    pricing: {
      title: '先免费看，值得再付',
      sub: '一顿饭的钱，避免一个错误的租约。',
      free: { name: '免费版', price: '$0', items: ['综合评分与判定', '3 条最要紧的洞察', '不需要注册'], cta: '免费开始' },
      pro: {
        name: '专业版报告',
        price: `$${PRICE_USD}`,
        unit: '/ 份',
        badge: '最常选',
        items: ['封面 + 15 页浅色 PDF，可打印', '真实地图四圈层商圈', '同菜系竞品逐家对标', '需求分流模型 + 保本线 + 三档营收', '风险登记 + 签约前清单 + 90 天计划', '补充座位、客单价、你知道的竞品后可免费重算'],
        cta: '先免费测算，再决定',
      },
    },
    audiences: {
      title: '为谁做的',
      items: [
        { title: '第一次开店的老板', body: '把「感觉不错」变成看得懂的数字，再决定签不签。' },
        { title: '拓店中的连锁品牌', body: '同一套标准评估每个候选铺位，一天看十个地址。' },
        { title: '商业地产经纪与房东', body: '给餐饮租客一份第三方数据报告，成交更快。' },
        { title: 'POS / 支付 / 外卖 BD', body: '用选址报告作为拓客工具，先帮老板算账。' },
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        { q: '数据从哪来？可信吗？', a: '人口和收入来自美国人口普查局 ACS，就业岗位来自 LEHD LODES，门店信息来自 Google 地图与 Overture 开放地图，餐饮支出来自劳工统计局。报告最后一页列出每项数据的机构、更新日期和许可。' },
        { q: '拿不到的数据怎么办？', a: '写「未获取」，不估算、不编造。数据缺口太大时报告会标为预检版，并说明缺什么。' },
        { q: '要多久？', a: '免费结论 60 秒左右；专业版报告通常 1–3 分钟生成，可以离开页面稍后回来。' },
        { q: '报告能当投资建议吗？', a: '不能。它是基于公开数据的选址参考，帮你把问题问对、把账算清；签约前请实地核查并咨询专业顾问。' },
      ],
    },
    account: { title: '已经买过报告？', body: '登录后可以查看和下载所有已付费的报告。', signIn: '登录', register: '注册账号' },
    footer: { disclaimer: '© RestaurantIQ · 报告仅供选址参考，不构成投资、法律或租赁建议。', sources: '数据来源：U.S. Census Bureau · LEHD · Google Maps Platform · Overture Maps · BLS' },
  },
  en: {
    nav: { features: "What's inside", sample: 'Sample report', pricing: 'Pricing', faq: 'FAQ', signIn: 'Sign in', cta: 'Check a location' },
    hero: {
      eyebrow: 'Restaurant site-selection risk audit · U.S. Chinese restaurants',
      title: 'Before you sign the lease, let the data tell you if this trade area fits',
      headlines: [
        'Before you sign the lease, let the data tell you if this trade area fits',
        'Know whether this trade area can feed a restaurant, before you open',
        'Don’t sign on gut feel. Run the numbers on this location first',
        'Chinese households nearby, same-cuisine rivals, break-even: 60 seconds',
        'How much must this spot make each month? Find out before you sign',
        'Good locations backed by data. Bad ones flagged before you commit',
      ],
      subtitle: 'Type an address and a cuisine. In 60 seconds: Chinese households nearby, same-cuisine competitors, and the monthly revenue you need just to break even. Built on U.S. Census and open map data — every number traceable.',
      address: 'Restaurant address, e.g. 1711 El Camino Real, Millbrae, CA',
      cuisine: 'Cuisine or concept, e.g. Hunan, HK café, hot pot, boba',
      rent: 'Monthly rent USD',
      sqft: 'Size sqft',
      more: 'Add rent and size (optional, sharper finance)',
      less: 'Hide',
      cta: 'Get my free risk score',
      trust: ['Verdict in 60 seconds', 'U.S. Census · Google Maps · open data', 'Free tier needs no sign-up'],
    },
    how: {
      title: 'Three steps from address to verdict',
      steps: [
        { n: '1', title: 'Enter an address and cuisine', body: 'Rent, size and seats are optional; adding them sharpens the finance pages.' },
        { n: '2', title: 'Read the free summary', body: 'Overall score, verdict (GO / conditional / NO GO) and the three insights that matter, in about a minute.' },
        { n: '3', title: 'Unlock the full report when you need it', body: '16-page professional edition: trade area, competitors, demand, break-even, risks and the pre-lease checklist — printable PDF.' },
      ],
    },
    inside: {
      title: "What's inside",
      sub: 'Each page answers one question an owner actually asks, in plain language, with sourced numbers.',
      items: [
        { title: 'Real-map trade area', body: 'Walk 10 / drive 5 · 10 · 15 minute rings on a real map, with population, households and Chinese share per ring.' },
        { title: 'Competitors, one by one', body: 'A card per same-cuisine rival: distance, Google rating and reviews, price level, traffic tier, and how much of your demand it takes.' },
        { title: 'Demand vs break-even', body: 'Modelled monthly demand against this site’s break-even line: the gap, and what could close it.' },
        { title: 'Six-dimension score', body: 'Demand, competition, rent, audience, access, clustering — one total, one clear verdict.' },
        { title: 'Risks and pre-lease checklist', body: 'Probability × impact risk register, conditions to negotiate before signing, a 90-day opening plan.' },
        { title: 'Every number traceable', body: 'A sources page lists the agency, update date and license for each dataset; anything unavailable says so — nothing is made up.' },
      ],
    },
    sample: {
      eyebrow: 'Sample · Hunan restaurant @ Millbrae, CA',
      title: 'This one we talked out of signing',
      body: 'Same address as Cantonese / BBQ scores 79 (GO). The report doesn’t just say yes or no — it tells you what fits better.',
      verdict: 'NO GO',
      rows: [
        { label: 'Overall score', value: '43.3 / 100', note: '≥ 70 GO, 55–69 conditional' },
        { label: 'Demand coverage', value: '22%', note: 'Modelled demand ÷ break-even; needs ≥ 100%' },
        { label: 'Rent as % of revenue', value: '55%', note: 'Warning line 10%' },
        { label: 'Break-even', value: '$139,280 / mo', note: 'Fixed cost ÷ contribution margin' },
        { label: 'Same-cuisine · other Chinese', value: '4 · 25', note: 'Within a 10-minute drive' },
        { label: 'Data completeness', value: '85 / 100' },
      ],
      foot: 'Sample uses public data and assumed inputs (rent $17,000/mo, 2,500 sqft); it is not a customer report.',
    },
    pricing: {
      title: 'Look for free. Pay only if it’s worth it.',
      sub: 'The price of one dinner, against a wrong lease.',
      free: { name: 'Free', price: '$0', items: ['Overall score and verdict', 'Three key insights', 'No sign-up needed'], cta: 'Start free' },
      pro: {
        name: 'Professional report',
        price: `$${PRICE_USD}`,
        unit: '/ report',
        badge: 'Most chosen',
        items: ['Cover + 15 light pages, printable PDF', 'Four-ring trade area on a real map', 'Same-cuisine competitors, one by one', 'Demand model + break-even + three revenue scenarios', 'Risk register + pre-lease checklist + 90-day plan', 'Free re-run after you add seats, tickets or known competitors'],
        cta: 'Check my location first',
      },
    },
    audiences: {
      title: 'Built for',
      items: [
        { title: 'First-time owners', body: 'Turn “feels right” into numbers you can read before you sign.' },
        { title: 'Expanding chains', body: 'One standard for every candidate site; screen ten addresses in a day.' },
        { title: 'CRE brokers and landlords', body: 'Hand restaurant tenants a third-party data report; close faster.' },
        { title: 'POS / payments / delivery BD', body: 'Use the audit as a door-opener: help the owner run the numbers first.' },
      ],
    },
    faq: {
      title: 'FAQ',
      items: [
        { q: 'Where does the data come from?', a: 'Population and income from the U.S. Census Bureau (ACS), jobs from LEHD LODES, places from Google Maps and Overture Maps, dining spend from the BLS. The last page lists the agency, update date and license per dataset.' },
        { q: 'What if data is missing?', a: 'It says “unavailable”. Nothing is estimated or invented; when gaps are too large the report is marked pre-check and explains what is missing.' },
        { q: 'How long does it take?', a: 'The free verdict in about a minute; the professional report usually 1–3 minutes — you can leave the page and come back.' },
        { q: 'Is this investment advice?', a: 'No. It is a site-selection reference built on public data — it helps you ask the right questions and run the numbers. Verify on site and consult professionals before signing.' },
      ],
    },
    account: { title: 'Already bought a report?', body: 'Sign in to view and download every report you have paid for.', signIn: 'Sign in', register: 'Create account' },
    footer: { disclaimer: '© RestaurantIQ · For site-selection reference only; not investment, legal or leasing advice.', sources: 'Data: U.S. Census Bureau · LEHD · Google Maps Platform · Overture Maps · BLS' },
  },
};

/**
 * Typewriter for the hero headline: starts with the first phrase fully shown
 * (SSR / no-JS safe), holds, deletes, types the next. Honours
 * prefers-reduced-motion by never animating.
 */
function useTypewriter(phrases: string[], opts: { type?: number; erase?: number; hold?: number } = {}): { text: string; done: boolean } {
  const { type = 70, erase = 32, hold = 1900 } = opts;
  // Starts empty and types the first headline character by character on mount (the
  // caret blinks while the sentence holds); SEO / no-JS readers get the full text
  // from the sr-only copy rendered next to it.
  const [state, setState] = useState<{ i: number; n: number; dir: 'type' | 'hold' | 'erase' }>({ i: 0, n: 0, dir: 'type' });
  const key = phrases.join('\u0000');
  useEffect(() => {
    setState({ i: 0, n: 0, dir: 'type' });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof window === 'undefined' || phrases.length === 0) return;
    const cur = phrases[state.i] ?? '';
    let delay = type;
    let next = state;
    if (state.dir === 'hold') {
      if (phrases.length < 2) return; // a single headline stays put once typed
      delay = hold;
      next = { ...state, dir: 'erase' };
    } else if (state.dir === 'erase') {
      if (state.n > 0) next = { ...state, n: state.n - 1 };
      else next = { i: (state.i + 1) % phrases.length, n: 0, dir: 'type' };
      delay = erase;
    } else if (state.n < cur.length) {
      next = { ...state, n: state.n + 1 };
      delay = type + (Math.random() * 40 - 20);
    } else {
      next = { ...state, dir: 'hold' };
      delay = 0;
    }
    const t = setTimeout(() => setState(next), Math.max(0, delay));
    return () => clearTimeout(t);
  }, [state, phrases, type, erase, hold]);
  const cur = phrases[state.i] ?? '';
  return { text: cur.slice(0, state.n), done: state.dir === 'hold' };
}

/** Fisher–Yates shuffle of everything after the first (primary) headline, so each visit sees a different order. */
function shuffleAfterFirst(list: string[]): string[] {
  const rest = list.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [list[0], ...rest];
}

function HeroTitle({ headlines }: { headlines: string[] }) {
  const [order, setOrder] = useState<string[]>(headlines);
  useEffect(() => {
    setOrder(shuffleAfterFirst(headlines));
  }, [headlines]); // eslint-disable-line react-hooks/set-state-in-effect
  const { text, done } = useTypewriter(order, { type: 62, erase: 22, hold: 2600 });
  const longest = headlines.reduce((a, b) => (b.length > a.length ? b : a), '');
  return (
    <h1 className="font-cjk-serif text-[clamp(1.6rem,4.6vw,3.15rem)] font-black leading-[1.25] text-white">
      <span className="sr-only">{headlines[0]}</span>
      <span className="grid text-left md:whitespace-nowrap" aria-hidden>
        <span className="invisible col-start-1 row-start-1" aria-hidden>
          {longest}
        </span>
        <span className="col-start-1 row-start-1">
          {text}
          <span className={`ml-0.5 inline-block w-[0.06em] translate-y-[0.1em] bg-brand-green align-baseline ${done ? 'animate-pulse' : ''}`} style={{ height: '0.95em' }} aria-hidden />
        </span>
      </span>
    </h1>
  );
}

function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <Image src="/restaurant-iq-logo-mark.svg" alt="" width={32} height={32} className="h-8 w-8" priority />
      <span className="text-[17px] font-extrabold tracking-tight text-white">RestaurantIQ</span>
    </span>
  );
}

const CheckIcon = () => (
  <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 flex-none text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5l4 4 8-9" />
  </svg>
);

export default function IqLandingPage() {
  const [location, setLocation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [sqft, setSqft] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [locale, setLocale] = useState<Locale>('zh');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const router = useRouter();
  const t = COPY[locale];

  function handleSubmit() {
    if (!location.trim()) return;
    const params = new URLSearchParams({ location: location.trim(), businessType: businessType.trim(), lang: locale });
    if (monthlyRent.trim()) params.set('monthlyRentUsd', monthlyRent.trim());
    if (sqft.trim()) params.set('sqft', sqft.trim());
    router.push(`/iq/result?${params.toString()}`);
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main lang={locale === 'zh' ? 'zh-CN' : 'en'} className="font-cjk-sans min-h-screen bg-white text-brand-navy antialiased">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-brand-navy/95 text-white backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/iq" aria-label="RestaurantIQ">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-300 md:flex" aria-label="Sections">
            <button type="button" onClick={() => scrollTo('inside')} className="hover:text-white">{t.nav.features}</button>
            <button type="button" onClick={() => scrollTo('pricing')} className="hover:text-white">{t.nav.pricing}</button>
            <button type="button" onClick={() => scrollTo('faq')} className="hover:text-white">{t.nav.faq}</button>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setLocale((p) => (p === 'zh' ? 'en' : 'zh'))}
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
              aria-label="Toggle language"
            >
              {locale === 'zh' ? 'EN' : '中文'}
            </button>
            <Link href="/iq/login" className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-white/10 sm:inline-flex">
              {t.nav.signIn}
            </Link>
            <button type="button" onClick={() => scrollTo('top')} className="rounded-full bg-brand-green px-4 py-2 text-sm font-bold text-brand-navy hover:bg-emerald-400">
              {t.nav.cta}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section id="top" className="relative overflow-hidden bg-brand-navy text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-green/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-5xl text-center">
            <p className="mb-5 inline-flex rounded-full bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand-green ring-1 ring-brand-green/30">{t.hero.eyebrow}</p>
            <div className="mx-auto flex justify-center">
              <HeroTitle headlines={t.hero.headlines} />
            </div>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-300 md:text-lg">{t.hero.subtitle}</p>
          </div>

          {/* address search card */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="mx-auto mt-9 max-w-3xl rounded-3xl bg-white p-3 text-brand-navy shadow-[0_30px_80px_-30px_rgba(34,197,94,0.35)] ring-1 ring-white/10 sm:p-4"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-green">
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <input
                  type="text"
                  name="location"
                  autoComplete="street-address"
                  placeholder={t.hero.address}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  required
                  className="h-14 w-full bg-transparent text-[15px] text-brand-navy outline-none placeholder:text-zinc-400"
                />
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-green">
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v16m0-7h4a3 3 0 003-3V4M16 4h4v6a3 3 0 01-3 3h-1zm3 9v7" />
                </svg>
                <input
                  type="text"
                  name="businessType"
                  placeholder={t.hero.cuisine}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="h-14 w-full bg-transparent text-[15px] text-brand-navy outline-none placeholder:text-zinc-400"
                />
              </label>
            </div>
            {moreOpen ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="text" inputMode="decimal" placeholder={t.hero.rent} value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} className="h-12 rounded-2xl bg-zinc-50 px-4 text-[15px] text-brand-navy outline-none ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-green" />
                <input type="text" inputMode="decimal" placeholder={t.hero.sqft} value={sqft} onChange={(e) => setSqft(e.target.value)} className="h-12 rounded-2xl bg-zinc-50 px-4 text-[15px] text-brand-navy outline-none ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-green" />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={!location.trim()}
              className="mt-2 h-14 w-full rounded-2xl bg-brand-green px-6 text-[15px] font-bold text-brand-navy transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.hero.cta}
            </button>
            <button type="button" onClick={() => setMoreOpen((o) => !o)} className="mt-2 px-2 text-xs font-medium text-zinc-500 underline-offset-4 hover:text-brand-navy hover:underline" aria-expanded={moreOpen}>
              {moreOpen ? t.hero.less : t.hero.more}
            </button>
          </form>

          <ul className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-zinc-400">
            {t.hero.trust.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-green" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.how.title}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {t.how.steps.map((s) => (
              <li key={s.n} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green text-base font-extrabold text-brand-navy">{s.n}</div>
                <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── What's inside ──────────────────────────────────────────────── */}
      <section id="inside" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="max-w-2xl">
          <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.inside.title}</h2>
          <p className="mt-3 text-zinc-600">{t.inside.sub}</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.inside.items.map((f, i) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 p-6 transition hover:border-brand-green/50 hover:shadow-md">
              <div className="text-xs font-bold text-emerald-600">{String(i + 1).padStart(2, '0')}</div>
              <h3 className="mt-2 text-lg font-bold text-brand-navy">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample numbers ─────────────────────────────────────────────── */}
      <section id="sample" className="bg-brand-canvas">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">{t.sample.eyebrow}</p>
            <h2 className="font-cjk-serif mt-3 text-2xl font-black md:text-4xl">{t.sample.title}</h2>
            <p className="mt-4 text-zinc-600">{t.sample.body}</p>
            <div className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-brand-navy px-5 py-3 text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-red" aria-hidden />
              <span className="text-lg font-extrabold tracking-tight">{t.sample.verdict}</span>
            </div>
            <p className="mt-6 text-xs text-zinc-500">{t.sample.foot}</p>
          </div>
          <div className="rounded-3xl bg-white p-2 shadow-[0_20px_60px_-24px_rgba(20,20,19,0.3)] ring-1 ring-zinc-200">
            <dl className="divide-y divide-zinc-100">
              {t.sample.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                  <div>
                    <dt className="text-sm font-medium text-zinc-700">{r.label}</dt>
                    {r.note ? <dd className="text-xs text-zinc-400">{r.note}</dd> : null}
                  </div>
                  <dd className="text-right text-lg font-extrabold tabular-nums tracking-tight text-brand-navy">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.pricing.title}</h2>
          <p className="mt-3 text-zinc-600">{t.pricing.sub}</p>
        </div>
        <div className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-zinc-200 p-7">
            <div className="text-sm font-bold text-zinc-500">{t.pricing.free.name}</div>
            <div className="mt-2 text-4xl font-extrabold tracking-tight">{t.pricing.free.price}</div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-700">
              {t.pricing.free.items.map((i) => (
                <li key={i} className="flex gap-2"><CheckIcon />{i}</li>
              ))}
            </ul>
            <button type="button" onClick={() => scrollTo('top')} className="mt-8 w-full rounded-2xl border border-zinc-300 px-5 py-3 text-sm font-bold text-brand-navy hover:bg-zinc-50">{t.pricing.free.cta}</button>
          </div>
          <div className="relative rounded-3xl bg-brand-navy p-7 text-white ring-4 ring-brand-green/25">
            <span className="absolute -top-3 left-6 rounded-full bg-brand-green px-3 py-1 text-xs font-bold text-brand-navy">{t.pricing.pro.badge}</span>
            <div className="text-sm font-bold text-zinc-400">{t.pricing.pro.name}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight">{t.pricing.pro.price}</span>
              <span className="text-sm text-zinc-400">{t.pricing.pro.unit}</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-200">
              {t.pricing.pro.items.map((i) => (
                <li key={i} className="flex gap-2"><CheckIcon />{i}</li>
              ))}
            </ul>
            <button type="button" onClick={() => scrollTo('top')} className="mt-8 w-full rounded-2xl bg-brand-green px-5 py-3 text-sm font-bold text-brand-navy hover:bg-emerald-400">{t.pricing.pro.cta}</button>
          </div>
        </div>
      </section>

      {/* ── Audiences ──────────────────────────────────────────────────── */}
      <section className="border-y border-zinc-100 bg-brand-canvas">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <h2 className="font-cjk-serif text-2xl font-black md:text-3xl">{t.audiences.title}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.audiences.items.map((a) => (
              <div key={a.title} className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200">
                <h3 className="font-bold text-brand-navy">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.faq.title}</h2>
        <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
          {t.faq.items.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q}>
                <button type="button" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-bold text-brand-navy">
                  {f.q}
                  <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border border-zinc-300 text-lg leading-none transition ${open ? 'rotate-45' : ''}`} aria-hidden>+</span>
                </button>
                {open ? <p className="pb-5 text-sm leading-relaxed text-zinc-600">{f.a}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Final CTA + account ─────────────────────────────────────────── */}
      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.hero.title}</h2>
              <button type="button" onClick={() => scrollTo('top')} className="mt-6 rounded-2xl bg-brand-green px-6 py-3.5 text-sm font-bold text-brand-navy hover:bg-emerald-400">{t.hero.cta}</button>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-lg font-bold">{t.account.title}</h3>
              <p className="mt-2 text-sm text-zinc-300">{t.account.body}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/iq/login" className="rounded-2xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">{t.account.signIn}</Link>
                <Link href={`/sign-up?redirect_url=${encodeURIComponent('/iq/dashboard')}`} className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-navy hover:bg-zinc-200">{t.account.register}</Link>
              </div>
            </div>
          </div>
          <footer className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-zinc-400 md:flex-row md:items-center md:justify-between">
            <span>{t.footer.disclaimer}</span>
            <span>{t.footer.sources}</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
