---
title: "Country directory — e-invoicing system by country"
description: "The five countries Invoicerr supports, and around a hundred it does not: the local system, the authority, and what adding each one would involve."
sidebar_label: "Overview"
keywords: [e-invoicing by country, country support, Invoicerr countries]
---

# Country directory

Invoicerr supports **five countries**: Germany, France, Italy, Poland and Portugal. "Supports" has a
precise meaning here — those five have data files in the per-country catalogues under
`backend/src/modules/documents/`, and those files are the only thing that makes a country work,
because no business code in this repository ever asks "what country is this?".

Every other country listed below has **no data file anywhere in this repository**. Its page is not a
feature, not a roadmap entry and not a promise: it describes what that country's e-invoicing system
looks like, and what adding it to Invoicerr would involve, for whoever wants to be the one who adds
it. [Adding a country](../adding-a-country.md) is the procedure; these pages are the shopping lists.

What these pages are **not** is a legal reference. They name systems, authorities, platforms and
formats — things you can check by opening the authority's own site. Anything with a date, a rate or
a retention period on it is carried over from an earlier research pass in this repository's history,
is marked as inherited and unverified on the page itself, and has to be confirmed against a primary
source before it goes anywhere near a data file.

## Supported

Coverage is per mechanism, not a single yes or no. The [country compliance
matrix](../country-support/index.md) is regenerated from the data files on every docs build, and it
is the only page that can say which mechanism has a file today and which does not.

| Country | Mechanism-by-mechanism coverage |
|---|---|
| [Germany](./germany.md) | [Germany in the compliance matrix](../country-support/de.md) |
| [France](./france.md) | [France in the compliance matrix](../country-support/fr.md) |
| [Italy](./italy.md) | [Italy in the compliance matrix](../country-support/it.md) |
| [Poland](./poland.md) | [Poland in the compliance matrix](../country-support/pl.md) |
| [Portugal](./portugal.md) | [Portugal in the compliance matrix](../country-support/pt.md) |

## Not supported

No country policy, no identifiers, no tax system, no transmission channel — nothing. Each page names
the local system, the authority, the format family and the platform it would route through, and
lists the catalogue files someone would have to write.

### Europe (37)

| Country | Local system |
|---|---|
| [Albania](./albania.md) | CIS |
| [Austria](./austria.md) | — |
| [Belgium](./belgium.md) | — |
| [Bosnia and Herzegovina](./bosnia-and-herzegovina.md) | — |
| [Bulgaria](./bulgaria.md) | NIS |
| [Croatia](./croatia.md) | CIS |
| [Cyprus](./cyprus.md) | — |
| [Czech Republic](./czech-republic.md) | NEN |
| [Denmark](./denmark.md) | — |
| [Estonia](./estonia.md) | — |
| [Finland](./finland.md) | — |
| [Greece](./greece.md) | myDATA |
| [Hungary](./hungary.md) | Online Számla (RTIR) |
| [Ireland](./ireland.md) | — |
| [Latvia](./latvia.md) | EDS |
| [Liechtenstein](./liechtenstein.md) | — |
| [Lithuania](./lithuania.md) | SABIS |
| [Luxembourg](./luxembourg.md) | — |
| [Malta](./malta.md) | — |
| [Moldova](./moldova.md) | e-Factura |
| [Monaco](./monaco.md) | PDP/PPF |
| [Montenegro](./montenegro.md) | — |
| [Netherlands](./netherlands.md) | — |
| [North Macedonia](./north-macedonia.md) | MES |
| [Norway](./norway.md) | EHF |
| [Romania](./romania.md) | RO e-Factura |
| [San Marino](./san-marino.md) | — |
| [Serbia](./serbia.md) | SEF |
| [Slovakia](./slovakia.md) | — |
| [Slovenia](./slovenia.md) | e-Slog |
| [Spain](./spain.md) | VeriFactu |
| [Sweden](./sweden.md) | — |
| [Switzerland](./switzerland.md) | QR-bill |
| [Turkey](./turkey.md) | GİB e-Fatura |
| [Ukraine](./ukraine.md) | PROZORRO |
| [United Kingdom](./united-kingdom.md) | — |
| [Vatican City](./vatican-city.md) | — |

### Americas (20)

| Country | Local system |
|---|---|
| [Argentina](./argentina.md) | AFIP/ARCA |
| [Bolivia](./bolivia.md) | SIN |
| [Brazil](./brazil.md) | NF-e |
| [Canada](./canada.md) | — |
| [Chile](./chile.md) | SII |
| [Colombia](./colombia.md) | DIAN |
| [Costa Rica](./costa-rica.md) | MH |
| [Dominican Republic](./dominican-republic.md) | DGII |
| [Ecuador](./ecuador.md) | SRI |
| [El Salvador](./el-salvador.md) | MH |
| [Guatemala](./guatemala.md) | FEL |
| [Honduras](./honduras.md) | SAR |
| [Mexico](./mexico.md) | CFDI |
| [Nicaragua](./nicaragua.md) | DGI |
| [Panama](./panama.md) | DGI |
| [Paraguay](./paraguay.md) | SIFEN |
| [Peru](./peru.md) | SUNAT |
| [United States](./united-states.md) | — |
| [Uruguay](./uruguay.md) | DGI |
| [Venezuela](./venezuela.md) | SENIAT |

### Asia-Pacific (17)

| Country | Local system |
|---|---|
| [Australia](./australia.md) | — |
| [Bangladesh](./bangladesh.md) | NBR |
| [China](./china.md) | e-Fapiao |
| [India](./india.md) | IRP |
| [Indonesia](./indonesia.md) | e-Faktur |
| [Japan](./japan.md) | QIS |
| [Kazakhstan](./kazakhstan.md) | ESF |
| [Malaysia](./malaysia.md) | MyInvois |
| [Nepal](./nepal.md) | IRD |
| [New Zealand](./new-zealand.md) | — |
| [Pakistan](./pakistan.md) | FBR |
| [Philippines](./philippines.md) | BIR |
| [Singapore](./singapore.md) | InvoiceNow |
| [Sri Lanka](./sri-lanka.md) | IRD |
| [Taiwan](./taiwan.md) | eGUI |
| [Thailand](./thailand.md) | e-Tax Invoice |
| [Vietnam](./vietnam.md) | GDT |

### Africa (20)

| Country | Local system |
|---|---|
| [Algeria](./algeria.md) | DGI |
| [Angola](./angola.md) | AGT |
| [Benin](./benin.md) | e-MECeF |
| [Cameroon](./cameroon.md) | DGI |
| [Egypt](./egypt.md) | ETA |
| [Ethiopia](./ethiopia.md) | ETA |
| [Ghana](./ghana.md) | GRA |
| [Ivory Coast](./ivory-coast.md) | DGI |
| [Kenya](./kenya.md) | KRA |
| [Morocco](./morocco.md) | DGI |
| [Mozambique](./mozambique.md) | — |
| [Nigeria](./nigeria.md) | FIRS |
| [Rwanda](./rwanda.md) | EBM |
| [Senegal](./senegal.md) | DGID |
| [South Africa](./south-africa.md) | SARS |
| [Tanzania](./tanzania.md) | TRA |
| [Tunisia](./tunisia.md) | TEIF |
| [Uganda](./uganda.md) | EFRIS |
| [Zambia](./zambia.md) | ZRA |
| [Zimbabwe](./zimbabwe.md) | ZIMRA |

### Middle East (7)

| Country | Local system |
|---|---|
| [Bahrain](./bahrain.md) | NBR |
| [Jordan](./jordan.md) | ISTD |
| [Kuwait](./kuwait.md) | — |
| [Oman](./oman.md) | — |
| [Qatar](./qatar.md) | GTA |
| [Saudi Arabia](./saudi-arabia.md) | ZATCA |
| [United Arab Emirates](./united-arab-emirates.md) | — |

## Don't see your country, or want yours moved?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for your country, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose). Say which mechanism you need —
"a Belgian company can't send to a Belgian public buyer" is something someone can pick up; "please
add Belgium" is not.
