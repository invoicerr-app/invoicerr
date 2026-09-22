import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Translate, {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import BrandMark from '@site/src/components/BrandMark';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

/**
 * The stock Docusaurus hero — a full-bleed `hero--primary` colour band, a centred title, a tagline,
 * two buttons — is exactly what the owner flagged as unfinished (this task's own brief). Replaced
 * with a quieter block that sits directly on the page background: a documentation home page's job is
 * routing a reader to the right section fast, not re-selling the product (the separate marketing
 * site already does that), so this is deliberately composed rather than loud — no full-bleed fill,
 * no gradient, no motion. The brand mark next to the eyebrow is the one deliberate identity touch:
 * small enough not to duplicate the navbar's own logo, present enough that the page reads as the
 * same product the moment it loads.
 */
function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={clsx('container', styles.heroInner)}>
        <p className={styles.eyebrow}>
          <BrandMark className={styles.eyebrowMark} />
          <Translate id="homepage.eyebrow">Documentation</Translate>
        </p>
        <Heading as="h1" className={styles.title}>
          {siteConfig.title}
        </Heading>
        <p className={styles.tagline}>
          <Translate id="homepage.tagline">
            Open-source invoicing for freelancers
          </Translate>
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/user-guide/introduction">
            <Translate id="homepage.cta.getStarted">Get Started</Translate>
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/user-guide/docker-installation">
            <Translate id="homepage.cta.deployDocker">Deploy with Docker</Translate>
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description={translate({
        id: 'homepage.meta.description',
        message:
          'Documentation for Invoicerr, the open-source invoicing platform for freelancers.',
      })}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
