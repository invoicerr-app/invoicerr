import type {ComponentType, ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import Heading from '@theme/Heading';
import {FileOutput, Palette, Plug, Receipt, Server, Signature} from 'lucide-react';
import styles from './styles.module.css';

type FeatureItem = {
  title: ReactNode;
  // lucide-react icons all share this signature; typing against it (rather than `typeof Receipt`)
  // keeps the list agnostic to which specific icon each row picks.
  Icon: ComponentType<{className?: string; strokeWidth?: number}>;
  description: ReactNode;
  to: string;
};

// Same six product areas, same target links as before this pass — only the presentation changed.
// Icons are lucide-react (the exact package `frontend/package.json` already uses for every in-app
// icon, pinned to the same version) rather than emoji: a reader who has used the app recognizes
// these glyphs — `Receipt` and `Signature` in particular are close enough to literal synonyms of the
// emoji they replace (🧾, ✍️) that the swap reads as a direct translation, not a new choice.
const FeatureList: FeatureItem[] = [
  {
    title: (
      <Translate id="homepage.features.invoices.title">
        Invoices & Quotes
      </Translate>
    ),
    Icon: Receipt,
    description: (
      <Translate id="homepage.features.invoices.description">
        Create, send, and track invoices and quotes. Convert a signed quote into an invoice in a single click.
      </Translate>
    ),
    to: '/docs/user-guide/introduction',
  },
  {
    title: (
      <Translate id="homepage.features.signing.title">Quote Signing</Translate>
    ),
    Icon: Signature,
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
    Icon: FileOutput,
    description: (
      <Translate id="homepage.features.pdf.description">
        Generate clean PDF documents for quotes, invoices, and receipts, and send them by email directly from the app.
      </Translate>
    ),
    to: '/docs/user-guide/introduction',
  },
  {
    title: (
      <Translate id="homepage.features.branding.title">
        Clients & Branding
      </Translate>
    ),
    Icon: Palette,
    description: (
      <Translate id="homepage.features.branding.description">
        Manage clients and customize your company identity — logo, name, VAT, colors, and email templates.
      </Translate>
    ),
    to: '/docs/user-guide/introduction',
  },
  {
    title: (
      <Translate id="homepage.features.selfhosting.title">Self-Hosting</Translate>
    ),
    Icon: Server,
    description: (
      <Translate id="homepage.features.selfhosting.description">
        Docker & docker-compose ready, from a single container to a scaled multi-worker deployment.
      </Translate>
    ),
    to: '/docs/user-guide/docker-installation',
  },
  {
    title: (
      <Translate id="homepage.features.extensible.title">Extensible</Translate>
    ),
    Icon: Plug,
    description: (
      <Translate id="homepage.features.extensible.description">
        A documented REST API, a plugin system, and outgoing webhooks make Invoicerr easy to integrate and extend.
      </Translate>
    ),
    to: '/docs/developer-guide/plugin-system',
  },
];

function Feature({title, Icon, description, to}: FeatureItem) {
  return (
    <Link to={to} className={styles.featureCard}>
      <span className={styles.featureIcon}>
        <Icon className={styles.featureIconGlyph} strokeWidth={1.75} />
      </span>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p className={styles.featureDescription}>{description}</p>
    </Link>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.grid}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
