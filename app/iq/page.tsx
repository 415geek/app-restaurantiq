'use client';

/**
 * IQ funnel landing (app.restaurantiq.ai/).
 *
 * Light, product-led layout in the Owner.com / DoorDash idiom: a white canvas,
 * one bold headline, an address "search" card as the single hero action, real
 * report pages as the product shots, then how-it-works → what's inside →
 * sample numbers → pricing → audiences → FAQ → account footer. All copy is
 * bilingual; the sample block uses the golden Millbrae fixture (synthetic
 * inputs, real public data) — never a customer's report.
 */
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Locale = 'en' | 'zh';

const PRICE_USD = process.env.NEXT_PUBLIC_STRIPE_PRICE_USD?.trim() || '19';

type Copy = {
  nav: { features: string; sample: string; pricing: string; faq: string; signIn: string; cta: string };
  hero: { eyebrow: string; title: string; subtitle: string; address: string; cuisine: string; rent: string; sqft: string; more: string; less: string; cta: string; trust: string[] };
  shots: { title: string; sub: string; items: Array<{ src: string; label: string; caption: string }> };
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
      title: '签 lease 前，先算清楚这个铺位能不能赚钱',
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
    shots: {
      title: '不是一段 AI 建议，是一份能拿去谈租约的报告',
      sub: '封面 + 15 页，浅色打印版，可下载 PDF。下面是真实渲染的报告页。',
      items: [
        { src: '/marketing/iq/report-cover.png', label: '封面', caption: '地址、业态、真实地图' },
        { src: '/marketing/iq/report-map.png', label: '商圈地图', caption: '步行 / 开车四个可达范围，竞品编号标记' },
        { src: '/marketing/iq/report-competitors.png', label: '直接竞品', caption: '同菜系逐家对标：距离、评分、分流比例' },
        { src: '/marketing/iq/report-summary.png', label: '总结与建议', caption: '结论、三个决定性数字、签约前必须做的事' },
      ],
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
      title: 'Before you sign the lease, know if this location can make money',
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
    shots: {
      title: 'Not an AI essay. A report you can take to the lease negotiation.',
      sub: 'Cover + 15 light print-ready pages, downloadable as PDF. These are real rendered pages.',
      items: [
        { src: '/marketing/iq/report-cover.png', label: 'Cover', caption: 'Address, concept, real map' },
        { src: '/marketing/iq/report-map.png', label: 'Trade area', caption: 'Four walk / drive reach rings, numbered competitors' },
        { src: '/marketing/iq/report-competitors.png', label: 'Direct competitors', caption: 'Each rival: distance, rating, share of your traffic' },
        { src: '/marketing/iq/report-summary.png', label: 'Summary', caption: 'Verdict, three deciding numbers, must-dos before signing' },
      ],
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

function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <Image src="/restaurant-iq-logo-mark.svg" alt="" width={32} height={32} className="h-8 w-8" priority />
      <span className="text-[17px] font-extrabold tracking-tight text-zinc-900">RestaurantIQ</span>
    </span>
  );
}

const CheckIcon = () => (
  <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 flex-none text-brand-orange" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
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
    <main lang={locale === 'zh' ? 'zh-CN' : 'en'} className="min-h-screen bg-white text-zinc-900 antialiased [font-family:Inter,ui-sans-serif,system-ui,-apple-system,'PingFang_SC','Hiragino_Sans_GB','Microsoft_YaHei',sans-serif]">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/iq" aria-label="RestaurantIQ">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-600 md:flex" aria-label="Sections">
            <button type="button" onClick={() => scrollTo('inside')} className="hover:text-zinc-900">{t.nav.features}</button>
            <button type="button" onClick={() => scrollTo('sample')} className="hover:text-zinc-900">{t.nav.sample}</button>
            <button type="button" onClick={() => scrollTo('pricing')} className="hover:text-zinc-900">{t.nav.pricing}</button>
            <button type="button" onClick={() => scrollTo('faq')} className="hover:text-zinc-900">{t.nav.faq}</button>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setLocale((p) => (p === 'zh' ? 'en' : 'zh'))}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
              aria-label="Toggle language"
            >
              {locale === 'zh' ? 'EN' : '中文'}
            </button>
            <Link href="/iq/login" className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:inline-flex">
              {t.nav.signIn}
            </Link>
            <button type="button" onClick={() => scrollTo('top')} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700">
              {t.nav.cta}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section id="top" className="relative overflow-hidden bg-[#FFF8F3]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-orange/10 blur-3xl" aria-hidden />
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 inline-flex rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand-orange ring-1 ring-brand-orange/20">{t.hero.eyebrow}</p>
            <h1 className="text-[2.1rem] font-extrabold leading-[1.15] tracking-tight text-zinc-900 sm:text-5xl md:text-[3.4rem]">{t.hero.title}</h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-600 md:text-lg">{t.hero.subtitle}</p>
          </div>

          {/* address search card */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="mx-auto mt-9 max-w-3xl rounded-3xl bg-white p-3 shadow-[0_20px_60px_-20px_rgba(20,20,19,0.25)] ring-1 ring-zinc-200 sm:p-4"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-orange">
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-brand-orange" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
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
                  className="h-14 w-full bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400"
                />
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-orange">
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v16m0-7h4a3 3 0 003-3V4M16 4h4v6a3 3 0 01-3 3h-1zm3 9v7" />
                </svg>
                <input
                  type="text"
                  name="businessType"
                  placeholder={t.hero.cuisine}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="h-14 w-full bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400"
                />
              </label>
            </div>
            {moreOpen ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="text" inputMode="decimal" placeholder={t.hero.rent} value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} className="h-12 rounded-2xl bg-zinc-50 px-4 text-[15px] text-zinc-900 outline-none ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-orange" />
                <input type="text" inputMode="decimal" placeholder={t.hero.sqft} value={sqft} onChange={(e) => setSqft(e.target.value)} className="h-12 rounded-2xl bg-zinc-50 px-4 text-[15px] text-zinc-900 outline-none ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-orange" />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={!location.trim()}
              className="mt-2 h-14 w-full rounded-2xl bg-brand-orange px-6 text-[15px] font-bold text-white transition hover:bg-[#d9552a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.hero.cta}
            </button>
            <button type="button" onClick={() => setMoreOpen((o) => !o)} className="mt-2 px-2 text-xs font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline" aria-expanded={moreOpen}>
              {moreOpen ? t.hero.less : t.hero.more}
            </button>
          </form>

          <ul className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-zinc-500">
            {t.hero.trust.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-orange" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Product shots ──────────────────────────────────────────────── */}
      <section id="report" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-4xl">{t.shots.title}</h2>
          <p className="mt-3 text-zinc-600">{t.shots.sub}</p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.shots.items.map((s) => (
            <figure key={s.src} className="group rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-lg">
              <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
                <Image src={s.src} alt={s.label} width={770} height={1010} className="h-auto w-full" sizes="(min-width: 1024px) 260px, (min-width: 640px) 45vw, 90vw" />
              </div>
              <figcaption className="px-1 pt-3">
                <div className="text-sm font-bold text-zinc-900">{s.label}</div>
                <div className="text-xs text-zinc-500">{s.caption}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section className="bg-zinc-950 text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-4xl">{t.how.title}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {t.how.steps.map((s) => (
              <li key={s.n} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange text-base font-extrabold text-white">{s.n}</div>
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
          <h2 className="text-2xl font-extrabold tracking-tight md:text-4xl">{t.inside.title}</h2>
          <p className="mt-3 text-zinc-600">{t.inside.sub}</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.inside.items.map((f, i) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 p-6 transition hover:border-brand-orange/40 hover:shadow-md">
              <div className="text-xs font-bold text-brand-orange">{String(i + 1).padStart(2, '0')}</div>
              <h3 className="mt-2 text-lg font-bold text-zinc-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample numbers ─────────────────────────────────────────────── */}
      <section id="sample" className="bg-[#FFF8F3]">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-orange">{t.sample.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight md:text-4xl">{t.sample.title}</h2>
            <p className="mt-4 text-zinc-600">{t.sample.body}</p>
            <div className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-zinc-900 px-5 py-3 text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" aria-hidden />
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
                  <dd className="text-right text-lg font-extrabold tabular-nums tracking-tight text-zinc-900">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-4xl">{t.pricing.title}</h2>
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
            <button type="button" onClick={() => scrollTo('top')} className="mt-8 w-full rounded-2xl border border-zinc-300 px-5 py-3 text-sm font-bold text-zinc-900 hover:bg-zinc-50">{t.pricing.free.cta}</button>
          </div>
          <div className="relative rounded-3xl bg-zinc-900 p-7 text-white ring-4 ring-brand-orange/20">
            <span className="absolute -top-3 left-6 rounded-full bg-brand-orange px-3 py-1 text-xs font-bold text-white">{t.pricing.pro.badge}</span>
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
            <button type="button" onClick={() => scrollTo('top')} className="mt-8 w-full rounded-2xl bg-brand-orange px-5 py-3 text-sm font-bold text-white hover:bg-[#d9552a]">{t.pricing.pro.cta}</button>
          </div>
        </div>
      </section>

      {/* ── Audiences ──────────────────────────────────────────────────── */}
      <section className="border-y border-zinc-100 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">{t.audiences.title}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.audiences.items.map((a) => (
              <div key={a.title} className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200">
                <h3 className="font-bold text-zinc-900">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        <h2 className="text-2xl font-extrabold tracking-tight md:text-4xl">{t.faq.title}</h2>
        <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
          {t.faq.items.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q}>
                <button type="button" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-bold text-zinc-900">
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
      <section className="bg-zinc-950 text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight md:text-4xl">{t.hero.title}</h2>
              <button type="button" onClick={() => scrollTo('top')} className="mt-6 rounded-2xl bg-brand-orange px-6 py-3.5 text-sm font-bold text-white hover:bg-[#d9552a]">{t.hero.cta}</button>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-lg font-bold">{t.account.title}</h3>
              <p className="mt-2 text-sm text-zinc-300">{t.account.body}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/iq/login" className="rounded-2xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">{t.account.signIn}</Link>
                <Link href={`/sign-up?redirect_url=${encodeURIComponent('/iq/dashboard')}`} className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-200">{t.account.register}</Link>
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
