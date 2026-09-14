/**
 * IQ funnel landing (app.restaurantiq.ai/).
 *
 * Server shell: resolves the visitor's locale (`?lang=` > `iq_lang` cookie >
 * Accept-Language > English) so the first paint is already in the right
 * language, then hands off to the client landing (`components/iq/IqLanding`).
 */
import { IqLanding } from '@/components/iq/IqLanding';
import { resolveServerLocale } from '@/lib/i18n/server-locale';

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IqLandingPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const locale = await resolveServerLocale({ param: sp.lang });
  return <IqLanding initialLocale={locale} />;
}
