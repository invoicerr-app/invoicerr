import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import ComplianceCountryContent from '@site/src/components/ComplianceCountryContent';
import {complianceCountries} from '@site/src/data/countries';

interface ComplianceCountryPageProps {
  countryCode: string;
  markdown: string;
}

/**
 * Generic layout for all dynamically-generated /compliance/<country> pages.
 * Routes are created by the compliance-content-plugin based on files in documentation/compliance/.
 * This component receives the country code and markdown content as props from the plugin.
 */
export default function ComplianceCountryPage({
  countryCode,
  markdown,
}: ComplianceCountryPageProps): ReactNode {
  const countryInfo = complianceCountries[countryCode];
  if (!countryInfo) {
    return (
      <Layout title="Country Not Found">
        <div className="container margin-vert--lg">
          <h1>Country not found</h1>
        </div>
      </Layout>
    );
  }

  const {name, flag} = countryInfo;

  return (
    <Layout title={`${flag} ${name}`} description={`E-invoicing compliance for ${name}`}>
      <div className="container margin-vert--lg">
        <ComplianceCountryContent
          countryCode={countryCode}
          countryName={name}
          flag={flag}
          markdown={markdown}
        />
      </div>
    </Layout>
  );
}
