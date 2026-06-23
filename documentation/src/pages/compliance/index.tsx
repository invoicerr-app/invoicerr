import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Translate, {translate} from '@docusaurus/Translate';
import Heading from '@theme/Heading';
import {complianceCountries} from '@site/src/data/countries';
import styles from './styles.module.css';

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

        <Heading as="h1">
          <Translate id="compliance.page.heading">
            E-Invoicing Compliance
          </Translate>
        </Heading>
        <p>
          <Translate id="compliance.page.intro">
            Pick a country below to read its e-invoicing compliance notes —
            mandate status, authority, platform, and technical workflow.
          </Translate>
        </p>

        <div className="row margin-top--md">
          {Object.entries(complianceCountries).map(([code, {flag, name}]) => (
            <div className="col col--3" key={code}>
              <Link to={`/compliance/${code.toLowerCase()}`} className={styles.countryCard}>
                <span className={styles.flag} role="img" aria-hidden="true">
                  {flag}
                </span>
                <span className={styles.countryName}>{name}</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
