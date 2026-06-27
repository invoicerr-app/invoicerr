import {type ReactNode, useMemo, useState} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Translate, {translate} from '@docusaurus/Translate';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import {complianceCountries} from '@site/src/data/countries';
import styles from './styles.module.css';

type CountryMeta = {
  region?: string;
  status?: string;
  priority?: string;
  formats?: string[];
  scope?: string[];
};

type FacetKey = 'region' | 'scope' | 'status' | 'formats' | 'priority';

const FACET_ORDER: FacetKey[] = [
  'region',
  'scope',
  'status',
  'formats',
  'priority',
];

const facetTitle = (key: FacetKey): string =>
  ({
    region: translate({id: 'compliance.page.filter.region', message: 'Region'}),
    scope: translate({id: 'compliance.page.filter.scope', message: 'Scope'}),
    status: translate({id: 'compliance.page.filter.status', message: 'Status'}),
    formats: translate({
      id: 'compliance.page.filter.formats',
      message: 'Formats',
    }),
    priority: translate({
      id: 'compliance.page.filter.priority',
      message: 'Priority',
    }),
  })[key];

// Human-friendly labels for known enum values; falls back to the raw value
// (used for formats, which are proper nouns and need no translation).
const valueLabel = (key: FacetKey, value: string): string => {
  if (key === 'region') {
    const map: Record<string, string> = {
      Europe: translate({
        id: 'compliance.page.region.europe',
        message: 'Europe',
      }),
      Americas: translate({
        id: 'compliance.page.region.americas',
        message: 'Americas',
      }),
      Africa: translate({
        id: 'compliance.page.region.africa',
        message: 'Africa',
      }),
      'Middle East': translate({
        id: 'compliance.page.region.middleEast',
        message: 'Middle East',
      }),
      'Asia-Pacific': translate({
        id: 'compliance.page.region.asiaPacific',
        message: 'Asia-Pacific',
      }),
    };
    return map[value] ?? value;
  }
  if (key === 'status') {
    const map: Record<string, string> = {
      mandatory: translate({
        id: 'compliance.page.statusValue.mandatory',
        message: 'Mandatory',
      }),
      phased: translate({
        id: 'compliance.page.statusValue.phased',
        message: 'Phased',
      }),
      voluntary: translate({
        id: 'compliance.page.statusValue.voluntary',
        message: 'Voluntary',
      }),
      planned: translate({
        id: 'compliance.page.statusValue.planned',
        message: 'Planned',
      }),
      'post-audit': translate({
        id: 'compliance.page.statusValue.postAudit',
        message: 'Post-audit',
      }),
    };
    return map[value] ?? value;
  }
  if (key === 'priority') {
    const map: Record<string, string> = {
      high: translate({
        id: 'compliance.page.priorityValue.high',
        message: 'High',
      }),
      medium: translate({
        id: 'compliance.page.priorityValue.medium',
        message: 'Medium',
      }),
      low: translate({
        id: 'compliance.page.priorityValue.low',
        message: 'Low',
      }),
    };
    return map[value] ?? value;
  }
  return value;
};

const facetValues = (meta: CountryMeta | undefined, key: FacetKey): string[] => {
  if (!meta) return [];
  if (key === 'formats') return meta.formats ?? [];
  if (key === 'scope') return meta.scope ?? [];
  const v = meta[key];
  return v ? [v] : [];
};

function CountryExplorer(): ReactNode {
  const data = usePluginData('compliance-content-plugin') as
    | {_meta?: Record<string, CountryMeta>}
    | undefined;
  const metaByCode = data?._meta ?? {};

  const entries = Object.entries(complianceCountries);

  // Build available facet values from the data actually present.
  const facets = useMemo(() => {
    const acc = Object.fromEntries(
      FACET_ORDER.map((key) => [key, new Set<string>()]),
    ) as Record<FacetKey, Set<string>>;
    for (const [code] of entries) {
      const meta = metaByCode[code];
      for (const key of FACET_ORDER) {
        facetValues(meta, key).forEach((v) => acc[key].add(v));
      }
    }
    return FACET_ORDER.map((key) => ({
      key,
      values: [...acc[key]].sort(),
    })).filter((f) => f.values.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emptySelection = (): Record<FacetKey, string[]> =>
    Object.fromEntries(FACET_ORDER.map((key) => [key, []])) as Record<
      FacetKey,
      string[]
    >;

  const [selected, setSelected] = useState<Record<FacetKey, string[]>>(
    emptySelection(),
  );

  const toggle = (key: FacetKey, value: string) =>
    setSelected((prev) => {
      const set = new Set(prev[key]);
      set.has(value) ? set.delete(value) : set.add(value);
      return {...prev, [key]: [...set]};
    });

  const reset = () => setSelected(emptySelection());

  const hasActive = FACET_ORDER.some((key) => selected[key].length > 0);

  const visible = entries.filter(([code]) => {
    const meta = metaByCode[code];
    return FACET_ORDER.every((key) => {
      const picked = selected[key];
      if (picked.length === 0) return true;
      const values = facetValues(meta, key);
      return picked.some((p) => values.includes(p));
    });
  });

  return (
    <>
      <div className={styles.filters}>
        {facets.map((facet) => (
          <div key={facet.key} className={styles.filterGroup}>
            <span className={styles.filterLabel}>{facetTitle(facet.key)}</span>
            <div className={styles.filterChips}>
              {facet.values.map((value) => {
                const active = selected[facet.key].includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    className={clsx(
                      styles.filterChip,
                      active && styles.filterChipActive,
                    )}
                    aria-pressed={active}
                    onClick={() => toggle(facet.key, value)}>
                    {valueLabel(facet.key, value)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.filterMeta}>
        <span className={styles.countBadge}>
          <Translate
            id="compliance.page.filter.count"
            values={{count: visible.length}}>
            {'{count} countries'}
          </Translate>
        </span>
        {hasActive && (
          <button
            type="button"
            className={styles.filterReset}
            onClick={reset}>
            <Translate id="compliance.page.filter.reset">Reset</Translate>
          </button>
        )}
      </div>

      <div className="row margin-top--md">
        {visible.map(([code, {flag, name}]) => (
          <div className="col col--3" key={code}>
            <Link
              to={`/compliance/${code.toLowerCase()}`}
              className={styles.countryCard}>
              <span className={styles.flag} role="img" aria-hidden="true">
                {flag}
              </span>
              <span className={styles.countryName}>{name}</span>
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}

type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const statusFlow: {id: string; label: ReactNode; tone: StatusTone}[] = [
  {
    id: 'draft',
    tone: 'neutral',
    label: <Translate id="compliance.page.status.draft">Draft</Translate>,
  },
  {
    id: 'issued',
    tone: 'info',
    label: <Translate id="compliance.page.status.issued">Issued</Translate>,
  },
  {
    id: 'pending',
    tone: 'warning',
    label: (
      <Translate id="compliance.page.status.pending">Pending</Translate>
    ),
  },
  {
    id: 'validated',
    tone: 'success',
    label: (
      <Translate id="compliance.page.status.validated">Validated</Translate>
    ),
  },
  {
    id: 'paid',
    tone: 'success',
    label: <Translate id="compliance.page.status.paid">Paid</Translate>,
  },
];

function StatusFlow(): ReactNode {
  return (
    <>
      <div className={styles.statusFlow}>
        {statusFlow.map((status, idx) => (
          <span key={status.id} className={styles.statusFlowItem}>
            <span className={clsx(styles.statusPill, styles[status.tone])}>
              {status.label}
            </span>
            {idx < statusFlow.length - 1 && (
              <span className={styles.statusArrow} aria-hidden="true">
                →
              </span>
            )}
          </span>
        ))}
      </div>
      <span className={clsx(styles.statusPill, styles.danger, styles.statusException)}>
        ✕{' '}
        <Translate id="compliance.page.status.refused">
          Refused / Cancelled
        </Translate>
      </span>
    </>
  );
}

const invoiceFormats = ['EN 16931', 'Factur-X', 'XRechnung', 'ZUGFeRD'];

function FormatChips(): ReactNode {
  return (
    <div className={styles.formatChips}>
      {invoiceFormats.map((format, idx) => (
        <span
          key={format}
          className={clsx(styles.chip, idx === 0 && styles.chipPrimary)}>
          {format}
        </span>
      ))}
    </div>
  );
}

type FeatureItem = {icon: string; label: ReactNode};

const features: FeatureItem[] = [
  {
    icon: '🧩',
    label: (
      <Translate id="compliance.page.criteria.formats">
        Support structured formats (EN 16931, XRechnung, ZUGFeRD, etc.).
      </Translate>
    ),
  },
  {
    icon: '🔁',
    label: (
      <Translate id="compliance.page.criteria.pdp">
        Allow sending/receiving invoices through accredited PDPs.
      </Translate>
    ),
  },
  {
    icon: '📝',
    label: (
      <Translate id="compliance.page.criteria.mentions">
        Add the new mandatory mentions to generated invoices.
      </Translate>
    ),
  },
  {
    icon: '🗄️',
    label: (
      <Translate id="compliance.page.criteria.archiving">
        Ensure legal archiving for 10 years.
      </Translate>
    ),
  },
  {
    icon: '📊',
    label: (
      <Translate id="compliance.page.criteria.ereporting">
        Facilitate e-reporting to the tax administration.
      </Translate>
    ),
  },
  {
    icon: '📒',
    label: (
      <Translate id="compliance.page.criteria.directory">
        Connect to the central directory to verify e-invoicing addresses.
      </Translate>
    ),
  },
];

function FeatureGrid(): ReactNode {
  return (
    <div className={styles.featureGrid}>
      {features.map((feature, idx) => (
        <div key={idx} className={styles.featureItem}>
          <span className={styles.featureIcon} role="img" aria-hidden="true">
            {feature.icon}
          </span>
          <span>{feature.label}</span>
        </div>
      ))}
    </div>
  );
}

function PdpBanner(): ReactNode {
  return (
    <div className={styles.pdpBanner}>
      <span className={styles.pdpBannerIcon} role="img" aria-hidden="true">
        🔐
      </span>
      <div className={styles.pdpBannerText}>
        <span className={styles.pdpBannerBadge}>
          🇫🇷{' '}
          <Translate id="compliance.page.pdp.country">For France</Translate>
        </span>
        <p className={styles.pdpBannerBody}>
          <Translate
            id="compliance.page.eu.card.transmission.pdp"
            values={{
              link: (
                <Link to="https://superpdp.tech" className={styles.pdpBannerLink}>
                  superpdp.tech
                </Link>
              ),
            }}>
            {
              'Invoicerr ensures compliance through {link}, an accredited Plateforme de Dématérialisation Partenaire (PDP), which handles transmission and validation on your behalf.'
            }
          </Translate>
        </p>
      </div>
      <Link
        to="https://superpdp.tech"
        className={clsx('button button--primary', styles.pdpBannerCta)}>
        <Translate id="compliance.page.pdp.cta">Learn more</Translate>
      </Link>
    </div>
  );
}

export default function CompliancePage(): ReactNode {
  return (
    <Layout
      title={translate({
        id: 'compliance.page.title',
        message: 'Compliance',
      })}
      description={translate({
        id: 'compliance.page.description',
        message:
          'E-invoicing compliance rules by country, sourced from the Invoicerr repository.',
      })}>
      <div className="container margin-vert--lg">
        <nav className="breadcrumbs" aria-label="breadcrumbs">
          <ul className="breadcrumbs">
            <li className="breadcrumbs__item">
              <Link className="breadcrumbs__link" to="/">
                <Translate id="compliance.breadcrumb.home">Home</Translate>
              </Link>
            </li>
            <li className="breadcrumbs__item breadcrumbs__item--active">
              <span className="breadcrumbs__link">
                <Translate id="compliance.breadcrumb.compliance">
                  Compliance
                </Translate>
              </span>
            </li>
          </ul>
        </nav>

        <div className={styles.pageHeader}>
          <Heading as="h1" className={styles.pageTitle}>
            <Translate id="compliance.page.heading">
              E-Invoicing Compliance
            </Translate>
          </Heading>
          <span className={styles.timelineBadge}>
            <Translate id="compliance.page.eu.timeline">2026 → 2030</Translate>
          </span>
        </div>
        <p>
          <Translate id="compliance.page.eu.intro">
            The European Union is rolling out structured e-invoicing across
            all member states. Here is what that means in practice, broken
            down into three areas.
          </Translate>
        </p>

        {/* 1. The essentials — three enriched pillar cards */}
        <div className="row margin-top--md">
          <div className="col col--4">
            <div className={styles.domainCard}>
              <span className={styles.domainIcon} role="img" aria-hidden="true">
                🇪🇺
              </span>
              <Heading as="h3">
                <Translate id="compliance.page.eu.card.vida.title">
                  The ViDA Reform
                </Translate>
              </Heading>
              <p>
                <Translate id="compliance.page.eu.card.vida.body">
                  The ViDA (VAT in the Digital Age) reform generalizes
                  Continuous Transaction Controls (CTC) across the EU, with
                  mandates phasing in progressively from 2026 onward.
                </Translate>
              </p>
            </div>
          </div>

          <div className="col col--4">
            <div className={styles.domainCard}>
              <span className={styles.domainIcon} role="img" aria-hidden="true">
                🔄
              </span>
              <Heading as="h3">
                <Translate id="compliance.page.eu.card.lifecycle.title">
                  Invoice Lifecycle
                </Translate>
              </Heading>
              <p>
                <Translate id="compliance.page.eu.card.lifecycle.body">
                  Each invoice carries a status that updates automatically as
                  it moves through its journey:
                </Translate>
              </p>
              <StatusFlow />
            </div>
          </div>

          <div className="col col--4">
            <div className={styles.domainCard}>
              <span className={styles.domainIcon} role="img" aria-hidden="true">
                📄
              </span>
              <Heading as="h3">
                <Translate id="compliance.page.eu.card.transmission.title">
                  Structured Formats
                </Translate>
              </Heading>
              <p>
                <Translate id="compliance.page.eu.card.transmission.body">
                  Beyond the visible PDF, every invoice carries structured
                  data readable automatically by tax authorities and software:
                </Translate>
              </p>
              <FormatChips />
            </div>
          </div>
        </div>

        {/* 2. New mandatory mentions — highlighted callout */}
        <div className={styles.mentionsCard}>
          <Heading as="h3" className={styles.mentionsTitle}>
            <Translate id="compliance.page.mentions.heading">
              New Mandatory Invoice Mentions
            </Translate>
          </Heading>
          <ul className={clsx(styles.checklist, styles.checklistTwoCol)}>
            <li>
              <Translate id="compliance.page.mentions.siren">
                The customer's SIREN number
              </Translate>
            </li>
            <li>
              <Translate id="compliance.page.mentions.category">
                The transaction category (e.g. supply of goods, provision of
                services)
              </Translate>
            </li>
            <li>
              <Translate id="compliance.page.mentions.vatOption">
                The optional VAT-on-debits election, if applicable
              </Translate>
            </li>
            <li>
              <Translate id="compliance.page.mentions.deliveryAddress">
                The delivery address, if it differs from the billing address
              </Translate>
            </li>
          </ul>
        </div>

        {/* 3. What Invoicerr implements — icon feature grid */}
        <Heading as="h2" className="margin-top--lg">
          <Translate id="compliance.page.criteria.heading">
            What Invoicerr Implements
          </Translate>
        </Heading>
        <FeatureGrid />

        {/* 4. PDP highlight banner */}
        <PdpBanner />

        {/* 5. Regulation by country */}
        <Heading as="h2" className="margin-top--lg">
          <Translate id="compliance.page.countries.heading">
            Regulation by Country
          </Translate>
        </Heading>
        <CountryExplorer />
      </div>
    </Layout>
  );
}
