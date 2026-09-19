# Company lookup — national business registers

Autofill of the company and client forms from the **official register of the selected
country**. One port, one provider per country, one normalized result.

- Code: `backend/src/modules/company-lookup/`
- One file per country in `providers/` (`fr.provider.ts`, `cz.provider.ts`, …), plus
  `vies.provider.ts` for the cross-border EU VAT check.
- API: `GET /api/company-lookup?country=FR&value=…[&scheme=LEGAL_ID|VAT]`
- Capabilities: `GET /api/company-lookup/capabilities[/:countryCode]` (public — the
  onboarding form reads it before a session is fully settled)
- Frontend hook: `frontend/src/hooks/use-company-lookup.ts`

The identifier schemes are the ones the compliance profiles already declare in
`requiredIdentifiers`: `LEGAL_ID` (the national registration number) and `VAT`.
Resolution order per country: **national register → VIES → GLEIF → Peppol Directory**.
The national register returns the legal name, address and registration date; VIES
confirms the EU VAT number; the two worldwide directories are the keyless safety net for
every country that publishes nothing. When a source only half-answers (VIES for a member
state that hides names), the next one completes it and `sourceLabel` names both —
`"VIES (EU VAT validation) + GLEIF (Global LEI Index)"`.

**No credential is needed anywhere.** Every country resolves with zero configuration; the
few registers that require a free key (GB, IE, NL, CH, AU, NZ) only *upgrade* their
country from `PARTIAL` to `REGISTER` coverage.

## Coverage

### Worldwide, keyless — the fallback for every country

| Source | What it answers | Endpoint |
|---|---|---|
| **GLEIF** (Global LEI Index) | ~2.8 M entities in ~200 jurisdictions, searched by the national registration number or by LEI — legal name, address, status | `api.gleif.org` |
| **Peppol Directory** | any business reachable on the Peppol network, by VAT/registration number — name, country, participant id | `directory.peppol.eu` |

Both are `coverage: PARTIAL`: they only hold entities that opted in (LEI holders, Peppol
participants), so a miss is not proof the company does not exist. The capability endpoint
says so per country, and the UI surfaces the note when the lookup comes up empty.

### National registers, keyless — work out of the box

| Country | Register | Endpoint |
|---|---|---|
| FR | Annuaire des Entreprises (INSEE SIRENE) | `recherche-entreprises.api.gouv.fr` |
| CZ | ARES (Ministerstvo financí) | `ares.gov.cz` |
| SK | RPO (Štatistický úrad SR) | `api.statistics.sk` |
| PL | Wykaz podatników VAT (MF) | `wl-api.mf.gov.pl` |
| RO | ANAF | `webservicesp.anaf.ro` |
| NO | Enhetsregisteret (Brønnøysund) | `data.brreg.no` |
| DK | CVR | `cvrapi.dk` |
| FI | PRH / YTJ avoindata | `avoindata.prh.fi` |
| BR | Receita Federal (CNPJ) | `brasilapi.com.br` |
| PE | SUNAT | `api.apis.net.pe` |
| TW | 商工登記公示資料 (經濟部 GCIS) | `data.gcis.nat.gov.tw` |
| IL | רשם החברות (data.gov.il dataset) | `data.gov.il` |
| VN | Mã số thuế — third-party mirror of the tax register | `api.vietqr.io` |
| CO | RUES (Confecámaras, datos.gov.co) | `datos.gov.co` |
| EU 27 + XI | VIES VAT validation | `ec.europa.eu/taxation_customs/vies` |

### Optional keys — upgrade a country from PARTIAL to REGISTER coverage

| Country | Register | Env vars |
|---|---|---|
| GB | Companies House | `COMPANIES_HOUSE_API_KEY` |
| IE | CRO | `CRO_API_USER`, `CRO_API_KEY` |
| NL | KVK Handelsregister | `KVK_API_KEY` |
| CH, LI | Zefix | `ZEFIX_USER`, `ZEFIX_PASSWORD` |
| AU | ABN Lookup | `ABR_GUID` |
| NZ | NZBN register (MBIE) | `NZBN_API_KEY` |

All are free to register for; see `backend/.env.example`. None of them is required: while
a key is missing, that country still resolves through GLEIF and the Peppol Directory, and
the capability endpoint reports `coverage: PARTIAL`.

### Everything else

`GET /api/company-lookup/capabilities` returns an entry for **every** country the
compliance profiles know about, all of them `AVAILABLE`. Those without an open register
API report `coverage: PARTIAL` and a `note` explaining the situation (no federal register
in the US, Handelsregister has no API in Germany, GSTIN needs a paid GSP subscription in
India…) — see `COUNTRY_LOOKUP_NOTES` in `registry.ts`.

VIES is honest about its limits: it always validates the number, but the name and
address are only returned by the member states that disclose them (Italy does, Germany
and Spain do not). When a member state hides them the lookup still confirms the VAT
registration.

## Adding a country

1. Create `providers/xx.provider.ts` implementing `CompanyRegistryProvider` (or set
   `countries: 'ALL'` for a worldwide source, with `coverage: 'PARTIAL'`):
   `supports()` does the structural/checksum check offline, `lookup()` maps the payload
   onto `CompanyLookupCompany`, credentials (if any) are read from `process.env` inside
   `isConfigured()`.
2. Register it in `buildDefaultProviders()` in `registry.ts`.
3. Add a case to `providers.spec.ts` with a payload captured from the real register, and
   an entry in `company-lookup.live.spec.ts` if the register is keyless.

No change to the service, the controller or the frontend is needed.

## Testing

```bash
# Unit (mocked HTTP) — runs in CI
npx jest src/modules/company-lookup --no-coverage

# Live, opt-in, no credentials required: hits the real registers
COMPANY_LOOKUP_LIVE=1 npx jest company-lookup.live --no-coverage --runInBand
```
