import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ComplianceCountryContentProps {
  countryCode: string;
  countryName: string;
  flag: string;
  markdown: string;
}

/**
 * Renders the breadcrumb + markdown body for a /compliance/<country> page.
 * The markdown content is provided as a prop (from the plugin or other source).
 */
export default function ComplianceCountryContent({
  countryCode,
  countryName,
  flag,
  markdown,
}: ComplianceCountryContentProps): ReactNode {
  return (
    <>
      <nav className="breadcrumbs" aria-label="breadcrumbs">
        <ul className="breadcrumbs">
          <li className="breadcrumbs__item">
            <Link className="breadcrumbs__link" to="/">
              <Translate id="compliance.breadcrumb.home">Home</Translate>
            </Link>
          </li>
          <li className="breadcrumbs__item">
            <Link className="breadcrumbs__link" to="/compliance">
              <Translate id="compliance.breadcrumb.compliance">
                Compliance
              </Translate>
            </Link>
          </li>
          <li className="breadcrumbs__item breadcrumbs__item--active">
            <span className="breadcrumbs__link">
              {flag} {countryName}
            </span>
          </li>
        </ul>
      </nav>

      <article className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </>
  );
}
