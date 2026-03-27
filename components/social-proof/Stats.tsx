'use client';

type StatsProps = {
  locale?: 'en' | 'zh';
  variant?: 'default' | 'compact';
};

const stats = {
  en: [
    { value: '12,847', label: 'Reports generated' },
    { value: '$2.4M', label: 'Potential losses avoided' },
    { value: '94%', label: 'Accuracy rate' },
  ],
  zh: [
    { value: '12,847', label: '已生成报告' },
    { value: '$240万', label: '帮助规避的潜在损失' },
    { value: '94%', label: '预测准确率' },
  ],
};

const testimonials = {
  en: [
    {
      quote: 'Saved me from signing a bad lease. The report showed competition density I completely missed.',
      author: 'Restaurant Owner, San Francisco',
    },
    {
      quote: 'Worth every penny. The risk analysis was spot-on.',
      author: 'Cafe Owner, New York',
    },
  ],
  zh: [
    {
      quote: '帮我避免了签一份糟糕的租约。报告显示了我完全忽略的竞争密度。',
      author: '餐厅老板，旧金山',
    },
    {
      quote: '物超所值。风险分析非常准确。',
      author: '咖啡店老板，纽约',
    },
  ],
};

export function SocialProofStats({ locale = 'en', variant = 'default' }: StatsProps) {
  const s = stats[locale];

  if (variant === 'compact') {
    return (
      <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
        <span>
          ✓ <strong className="text-gray-300">{s[0].value}</strong> {s[0].label}
        </span>
        <span className="hidden sm:inline">
          ✓ <strong className="text-gray-300">{s[2].value}</strong> {s[2].label}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="grid grid-cols-3 gap-4 text-center">
        {s.map((stat, i) => (
          <div key={i}>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="mt-1 text-xs text-gray-500">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SocialProofTestimonial({ locale = 'en' }: { locale?: 'en' | 'zh' }) {
  const t = testimonials[locale];
  const randomIndex = Math.floor(Math.random() * t.length);
  const testimonial = t[randomIndex];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="text-sm italic text-gray-400">"{testimonial.quote}"</p>
      <p className="mt-2 text-xs text-gray-600">— {testimonial.author}</p>
    </div>
  );
}

export function SocialProofBadge({ locale = 'en' }: { locale?: 'en' | 'zh' }) {
  const label = locale === 'zh' ? '已帮助 12,847 位老板做出更明智的选址决策' : '12,847 owners made smarter location decisions';

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-zinc-800/50 px-4 py-2 text-xs text-gray-400">
      <span className="flex h-2 w-2">
        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
      </span>
      {label}
    </div>
  );
}
