import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: ReactNode;
  emoji: string;
  description: ReactNode;
  to?: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: (
      <Translate id="homepage.features.invoices.title">
        Invoices & Quotes
      </Translate>
    ),
    emoji: '🧾',
    description: (
      <Translate id="homepage.features.invoices.description">
        Create, send, and track invoices and quotes. Convert a signed quote into an invoice in a single click.
      </Translate>
    ),
    to: '/docs/getting-started/introduction',
  },
  {
    title: (
      <Translate id="homepage.features.signing.title">Quote Signing</Translate>
    ),
    emoji: '✍️',
    description: (
      <Translate id="homepage.features.signing.description">
        Built-in signing workflow with secure tokens, so clients can review and sign quotes without an account.
      </Translate>
    ),
    to: '/docs/developer-guide/architecture',
  },
  {
    title: (
      <Translate id="homepage.features.pdf.title">PDF & Email</Translate>
    ),
    emoji: '📄',
    description: (
      <Translate id="homepage.features.pdf.description">
        Generate clean PDF documents for quotes, invoices, and receipts, and send them by email directly from the app.
      </Translate>
    ),
    to: '/docs/getting-started/introduction',
  },
  {
    title: (
      <Translate id="homepage.features.branding.title">
        Clients & Branding
      </Translate>
    ),
    emoji: '🎨',
    description: (
      <Translate id="homepage.features.branding.description">
        Manage clients and customize your company identity — logo, name, VAT, colors, and email templates.
      </Translate>
    ),
    to: '/docs/getting-started/introduction',
  },
  {
    title: (
      <Translate id="homepage.features.selfhosting.title">Self-Hosting</Translate>
    ),
    emoji: '🐳',
    description: (
      <Translate id="homepage.features.selfhosting.description">
        Docker & docker-compose ready. Run on SQLite for a quick start or PostgreSQL for production.
      </Translate>
    ),
    to: '/docs/getting-started/docker-installation',
  },
  {
    title: (
      <Translate id="homepage.features.extensible.title">Extensible</Translate>
    ),
    emoji: '🔌',
    description: (
      <Translate id="homepage.features.extensible.description">
        A documented REST API, a plugin system, and outgoing webhooks make Invoicerr easy to integrate and extend.
      </Translate>
    ),
    to: '/docs/developer-guide/plugin-system',
  },
];

function Feature({title, emoji, description, to}: FeatureItem) {
  const content = (
    <>
      <div className={styles.featureEmoji} role="img" aria-hidden="true">
        {emoji}
      </div>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p className={styles.featureDescription}>{description}</p>
    </>
  );

  return (
    <div className={clsx('col col--4')}>
      {to ? (
        <Link to={to} className={clsx(styles.featureCard, styles.featureCardLink)}>
          {content}
        </Link>
      ) : (
        <div className={styles.featureCard}>{content}</div>
      )}
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
