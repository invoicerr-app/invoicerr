import { Locale } from "date-fns";
import {
	af,
	ar,
	arDZ,
	arEG,
	arMA,
	arSA,
	arTN,
	az,
	be,
	beTarask,
	bg,
	bn,
	bs,
	ca,
	ckb,
	cs,
	cy,
	da,
	de,
	deAT,
	el,
	enAU,
	enCA,
	enGB,
	enIE,
	enIN,
	enNZ,
	enUS,
	enZA,
	eo,
	es,
	et,
	eu,
	faIR,
	fi,
	fr,
	frCA,
	frCH,
	fy,
	gd,
	gl,
	gu,
	he,
	hi,
	hr,
	ht,
	hu,
	hy,
	id,
	is,
	it,
	itCH,
	ja,
	jaHira,
	ka,
	kk,
	km,
	kn,
	ko,
	lb,
	lt,
	lv,
	mk,
	mn,
	ms,
	mt,
	nb,
	nl,
	nlBE,
	nn,
	oc,
	pl,
	pt,
	ptBR,
	ro,
	ru,
	se,
	sk,
	sl,
	sq,
	sr,
	srLatn,
	sv,
	ta,
	te,
	th,
	tr,
	ug,
	uk,
	uz,
	uzCyrl,
	vi,
	zhCN,
	zhHK,
	zhTW,
} from "date-fns/locale";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

const translations = import.meta.glob("../locales/**/*.json", {
	eager: true,
});

const resources: Record<string, { translation: Record<string, unknown> }> = {};

for (const path in translations) {
	const match = path.match(/\.\/locales\/([^/]+)\/translation\.json$/);
	if (!match) continue;
	const lang = match[1];
	resources[lang] = {
		translation: (translations[path] as { default: Record<string, unknown> })
			.default,
	};
}

i18n
	.use(
		new LanguageDetector(null, {
			order: ["navigator"],
			caches: [],
		}),
	)
	.use(initReactI18next)
	.init({
		resources,
		fallbackLng: "en",
		interpolation: {
			escapeValue: false,
		},
		load: "languageOnly",
	});

export function languageToLocale(lang: string): Locale {
	switch (lang) {
		case "af":
			return af;
		case "ar":
			return ar;
		case "ar-DZ":
			return arDZ;
		case "ar-EG":
			return arEG;
		case "ar-MA":
			return arMA;
		case "ar-SA":
			return arSA;
		case "ar-TN":
			return arTN;
		case "az":
			return az;
		case "be":
			return be;
		case "be-tarask":
			return beTarask;
		case "bg":
			return bg;
		case "bn":
			return bn;
		case "bs":
			return bs;
		case "ca":
			return ca;
		case "ckb":
			return ckb;
		case "cs":
			return cs;
		case "cy":
			return cy;
		case "da":
			return da;
		case "de":
			return de;
		case "de-AT":
			return deAT;
		case "el":
			return el;
		case "en-AU":
			return enAU;
		case "en-CA":
			return enCA;
		case "en-GB":
			return enGB;
		case "en-IE":
			return enIE;
		case "en-IN":
			return enIN;
		case "en-NZ":
			return enNZ;
		case "en-US":
			return enUS;
		case "en-ZA":
			return enZA;
		case "eo":
			return eo;
		case "es":
			return es;
		case "et":
			return et;
		case "eu":
			return eu;
		case "fa-IR":
			return faIR;
		case "fi":
			return fi;
		case "fr":
			return fr;
		case "fr-CA":
			return frCA;
		case "fr-CH":
			return frCH;
		case "fy":
			return fy;
		case "gd":
			return gd;
		case "gl":
			return gl;
		case "gu":
			return gu;
		case "he":
			return he;
		case "hi":
			return hi;
		case "hr":
			return hr;
		case "ht":
			return ht;
		case "hu":
			return hu;
		case "hy":
			return hy;
		case "id":
			return id;
		case "is":
			return is;
		case "it":
			return it;
		case "it-CH":
			return itCH;
		case "ja":
			return ja;
		case "ja-Hira":
			return jaHira;
		case "ka":
			return ka;
		case "kk":
			return kk;
		case "km":
			return km;
		case "kn":
			return kn;
		case "ko":
			return ko;
		case "lb":
			return lb;
		case "lt":
			return lt;
		case "lv":
			return lv;
		case "mk":
			return mk;
		case "mn":
			return mn;
		case "ms":
			return ms;
		case "mt":
			return mt;
		case "nb":
			return nb;
		case "nl":
			return nl;
		case "nl-BE":
			return nlBE;
		case "nn":
			return nn;
		case "oc":
			return oc;
		case "pl":
			return pl;
		case "pt":
			return pt;
		case "pt-BR":
			return ptBR;
		case "ro":
			return ro;
		case "ru":
			return ru;
		case "se":
			return se;
		case "sk":
			return sk;
		case "sl":
			return sl;
		case "sq":
			return sq;
		case "sr":
			return sr;
		case "sr-Latn":
			return srLatn;
		case "sv":
			return sv;
		case "ta":
			return ta;
		case "te":
			return te;
		case "th":
			return th;
		case "tr":
			return tr;
		case "ug":
			return ug;
		case "uk":
			return uk;
		case "uz":
			return uz;
		case "uz-Cyrl":
			return uzCyrl;
		case "vi":
			return vi;
		case "zh-CN":
			return zhCN;
		case "zh-HK":
			return zhHK;
		case "zh-TW":
			return zhTW;

		default:
			return enUS;
	}
}
