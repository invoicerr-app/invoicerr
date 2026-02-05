import countries from 'i18n-iso-countries';
// Import all common country locales - these cover most languages
// Adding a new app translation that matches one of these will work automatically
import arLocale from 'i18n-iso-countries/langs/ar.json';
import bgLocale from 'i18n-iso-countries/langs/bg.json';
import csLocale from 'i18n-iso-countries/langs/cs.json';
import daLocale from 'i18n-iso-countries/langs/da.json';
import deLocale from 'i18n-iso-countries/langs/de.json';
import elLocale from 'i18n-iso-countries/langs/el.json';
import enLocale from 'i18n-iso-countries/langs/en.json';
import esLocale from 'i18n-iso-countries/langs/es.json';
import etLocale from 'i18n-iso-countries/langs/et.json';
import fiLocale from 'i18n-iso-countries/langs/fi.json';
import frLocale from 'i18n-iso-countries/langs/fr.json';
import heLocale from 'i18n-iso-countries/langs/he.json';
import hrLocale from 'i18n-iso-countries/langs/hr.json';
import huLocale from 'i18n-iso-countries/langs/hu.json';
import itLocale from 'i18n-iso-countries/langs/it.json';
import jaLocale from 'i18n-iso-countries/langs/ja.json';
import koLocale from 'i18n-iso-countries/langs/ko.json';
import ltLocale from 'i18n-iso-countries/langs/lt.json';
import lvLocale from 'i18n-iso-countries/langs/lv.json';
import nbLocale from 'i18n-iso-countries/langs/nb.json';
import nlLocale from 'i18n-iso-countries/langs/nl.json';
import plLocale from 'i18n-iso-countries/langs/pl.json';
import ptLocale from 'i18n-iso-countries/langs/pt.json';
import roLocale from 'i18n-iso-countries/langs/ro.json';
import ruLocale from 'i18n-iso-countries/langs/ru.json';
import skLocale from 'i18n-iso-countries/langs/sk.json';
import slLocale from 'i18n-iso-countries/langs/sl.json';
import srLocale from 'i18n-iso-countries/langs/sr.json';
import svLocale from 'i18n-iso-countries/langs/sv.json';
import trLocale from 'i18n-iso-countries/langs/tr.json';
import ukLocale from 'i18n-iso-countries/langs/uk.json';
import viLocale from 'i18n-iso-countries/langs/vi.json';
import zhLocale from 'i18n-iso-countries/langs/zh.json';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Register all country locales
// This covers all EU languages + major world languages
countries.registerLocale(arLocale);
countries.registerLocale(bgLocale);
countries.registerLocale(csLocale);
countries.registerLocale(daLocale);
countries.registerLocale(deLocale);
countries.registerLocale(elLocale);
countries.registerLocale(enLocale);
countries.registerLocale(esLocale);
countries.registerLocale(etLocale);
countries.registerLocale(fiLocale);
countries.registerLocale(frLocale);
countries.registerLocale(heLocale);
countries.registerLocale(hrLocale);
countries.registerLocale(huLocale);
countries.registerLocale(itLocale);
countries.registerLocale(jaLocale);
countries.registerLocale(koLocale);
countries.registerLocale(ltLocale);
countries.registerLocale(lvLocale);
countries.registerLocale(nbLocale);
countries.registerLocale(nlLocale);
countries.registerLocale(plLocale);
countries.registerLocale(ptLocale);
countries.registerLocale(roLocale);
countries.registerLocale(ruLocale);
countries.registerLocale(skLocale);
countries.registerLocale(slLocale);
countries.registerLocale(srLocale);
countries.registerLocale(svLocale);
countries.registerLocale(trLocale);
countries.registerLocale(ukLocale);
countries.registerLocale(viLocale);
countries.registerLocale(zhLocale);

// Map app language codes to i18n-iso-countries language codes
const langMapping: Record<string, string> = {
  'zh-Hans': 'zh',
  'pt-BR': 'pt',
};

interface CountrySelectProps {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  'data-cy'?: string;
}

export default function CountrySelect({
  value,
  onChange,
  disabled = false,
  'data-cy': dataCyValue,
}: CountrySelectProps) {
  const { t, i18n } = useTranslation();

  // Get the current language, map to i18n-iso-countries format
  const currentLang = i18n.language || 'en';
  const baseLang = langMapping[currentLang] || currentLang.split('-')[0];
  // Check if locale is registered, fallback to 'en'
  const supportedLang = countries.langs().includes(baseLang) ? baseLang : 'en';

  // Get all countries sorted by name in current language
  const sortedCountries = useMemo(() => {
    const allCountries = countries.getNames(supportedLang, { select: 'official' });
    return Object.entries(allCountries)
      .map(([code, name]) => ({ code, name: name as string }))
      .sort((a, b) => a.name.localeCompare(b.name, supportedLang));
  }, [supportedLang]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" data-cy={dataCyValue}>
        <SelectValue placeholder={t('settings.company.form.country.placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {sortedCountries.map(({ code, name }) => (
          <SelectItem key={code} value={code}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Get country name by code in a specific language
 */
export function getCountryName(code: string, lang = 'en'): string {
  const baseLang = langMapping[lang] || lang.split('-')[0];
  const supportedLang = countries.langs().includes(baseLang) ? baseLang : 'en';
  return countries.getName(code, supportedLang, { select: 'official' }) || code;
}
