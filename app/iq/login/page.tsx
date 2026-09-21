import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { resolveClerkRedirectTarget } from '@/lib/clerk-redirect-url';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { resolveServerLocale } from '@/lib/i18n/server-locale';

const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const COPY: Record<
  Locale,
  {
    metaTitle: string;
    metaDescription: string;
    title: string;
    sub: string;
    disabledTitle: string;
    notConfiguredTitle: string;
    disabledBody: string;
    notConfiguredBody: string;
    backHome: string;
    admin: string;
  }
> = {
  en: {
    metaTitle: 'Sign in · RestaurantIQ',
    metaDescription: 'Sign in or create a free account to manage your purchased RestaurantIQ reports.',
    title: 'Sign in to manage your reports',
    sub: 'New here? Create a free account to save and revisit the reports you’ve purchased.',
    disabledTitle: 'Sign-in is temporarily disabled',
    notConfiguredTitle: 'Authentication is not configured',
    disabledBody: 'Sign-in is paused while the Clerk keys are being rotated.',
    notConfiguredBody: 'Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to enable sign-in.',
    backHome: 'Back to home',
    admin: 'Workspace administrator console',
  },
  zh: {
    metaTitle: '登录 · RestaurantIQ',
    metaDescription: '登录或免费注册，管理你已购买的 RestaurantIQ 报告。',
    title: '登录以管理你的报告',
    sub: '第一次来？免费注册账号，保存并随时查看已购买的报告。',
    disabledTitle: '登录功能暂时关闭',
    notConfiguredTitle: '尚未配置登录服务',
    disabledBody: 'Clerk 密钥轮换期间登录暂停。',
    notConfiguredBody: '请配置 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY 和 CLERK_SECRET_KEY 以启用登录。',
    backHome: '返回首页',
    admin: '工作区管理员控制台',
  },
  es: {
    metaTitle: 'Iniciar sesión · RestaurantIQ',
    metaDescription: 'Inicia sesión o crea una cuenta gratis para administrar los informes de RestaurantIQ que compraste.',
    title: 'Inicia sesión para administrar tus informes',
    sub: '¿Eres nuevo? Crea una cuenta gratis para guardar y volver a consultar los informes que compraste.',
    disabledTitle: 'El inicio de sesión está desactivado temporalmente',
    notConfiguredTitle: 'La autenticación no está configurada',
    disabledBody: 'El inicio de sesión está en pausa mientras se rotan las claves de Clerk.',
    notConfiguredBody: 'Agrega NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY para habilitar el inicio de sesión.',
    backHome: 'Volver al inicio',
    admin: 'Consola de administración del espacio de trabajo',
  },
};

export async function generateMetadata({ searchParams }: LoginPageProps) {
  const sp = (await (searchParams ?? Promise.resolve({}))) as Record<string, string | string[] | undefined>;
  const locale = await resolveServerLocale({ param: sp.lang });
  return { title: COPY[locale].metaTitle, description: COPY[locale].metaDescription };
}

export default async function IqLoginPage({ searchParams }: LoginPageProps) {
  const sp = (await (searchParams ?? Promise.resolve({}))) as Record<string, string | string[] | undefined>;
  const locale = await resolveServerLocale({ param: sp.lang });
  const t = COPY[locale];
  const redirectUrl = resolveClerkRedirectTarget(normalizeParam(sp.redirect_url) || withLang('/iq/dashboard', locale));

  return (
    <main lang={LOCALE_TAG[locale]} className="relative min-h-screen bg-brand-canvas text-brand-navy">
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link href={withLang('/iq', locale)} className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/restaurant-iq-logo-mark.svg" alt="" className="h-8 w-8" />
            <span className="text-base font-extrabold tracking-tight text-brand-navy">RestaurantIQ</span>
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-zinc-600">{t.sub}</p>
        </div>

        {isMockMode || !isClerkConfigured ? (
          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="text-base font-semibold text-brand-navy">
              {isClerkConfigured ? t.disabledTitle : t.notConfiguredTitle}
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              {isClerkConfigured ? t.disabledBody : t.notConfiguredBody}
            </p>
            <Link
              href={withLang('/iq', locale)}
              className="mt-4 inline-flex rounded-xl bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-soft"
            >
              {t.backHome}
            </Link>
          </div>
        ) : (
          <div className="w-full">
            <SignIn
              signUpUrl={`/sign-up?redirect_url=${encodeURIComponent(withLang('/iq/dashboard', locale))}`}
              forceRedirectUrl={redirectUrl}
              fallbackRedirectUrl={redirectUrl}
              // The root provider styles Clerk for the dark app shell; the funnel is light.
              appearance={{
                variables: {
                  colorPrimary: '#0B1220',
                  colorBackground: '#FFFFFF',
                  colorText: '#0B1220',
                  colorTextSecondary: '#52525B',
                  colorInputText: '#0B1220',
                  colorInputBackground: '#FFFFFF',
                },
                elements: {
                  card: 'border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
                  headerTitle: 'text-brand-navy',
                  headerSubtitle: 'text-zinc-600',
                  formFieldLabel: 'text-zinc-700',
                  formFieldInput: 'bg-white border-zinc-300 text-brand-navy placeholder:text-zinc-400',
                  formButtonPrimary: 'bg-brand-navy text-white hover:bg-brand-navy-soft',
                  footerActionText: 'text-zinc-600',
                  footerActionLink: 'text-brand-navy hover:underline',
                  dividerText: 'text-zinc-500',
                  dividerLine: 'bg-zinc-200',
                  socialButtonsBlockButton: 'bg-white border-zinc-300 text-brand-navy hover:bg-zinc-50',
                  socialButtonsBlockButtonText: 'text-brand-navy',
                  identityPreviewText: 'text-brand-navy',
                  formFieldHintText: 'text-zinc-500',
                  formFieldErrorText: 'text-brand-clay',
                  alert: 'bg-white border-zinc-200',
                  alertText: 'text-brand-navy',
                  otpCodeFieldInput: 'bg-white border-zinc-300 text-brand-navy',
                },
              }}
            />
          </div>
        )}

        {/* Inconspicuous admin trigger — small logo at bottom links to /admin/login */}
        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link
            href="/admin/login"
            aria-label={t.admin}
            title={t.admin}
            className="group inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white p-1.5 opacity-40 transition hover:opacity-90 focus:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/logo-mark.png"
              alt=""
              aria-hidden="true"
              className="h-3.5 w-3.5 object-contain grayscale group-hover:grayscale-0"
            />
          </Link>
          <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-400">v2 · RestaurantIQ</span>
        </div>
      </div>
    </main>
  );
}
