import path from 'path';
import fs from 'fs';
import matter from 'gray-matter';
import type {Plugin, LoadContext} from '@docusaurus/types';

interface CountryMeta {
  region?: string;
  status?: string;
  priority?: string;
  formats?: string[];
  scope?: string[];
  progress?: string;
}

interface CountryContent {
  code: string;
  name: string;
  markdown: string;
  meta: CountryMeta;
}

/**
 * Scans compliance markdown files from documentation/compliance/ at build time.
 * Extracts country code from filename (FI-Finland.md → FI).
 * Generates routes /compliance/<country> dynamically.
 * Exposes content via global data for backward compatibility.
 */
export default function complianceContentPlugin(
  context: LoadContext,
): Plugin<Record<string, string>> {
  const baseUrl = context.baseUrl;

  return {
    name: 'compliance-content-plugin',
    async loadContent() {
      const baseDir = path.join(__dirname, '..', 'compliance');
      const content: Record<string, string> = {};
      const countries: CountryContent[] = [];

      if (!fs.existsSync(baseDir)) {
        console.warn(`[compliance-plugin] ${baseDir} not found, skipping`);
        return content;
      }

      const files = await fs.promises.readdir(baseDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const match = file.match(/^([A-Z]{2})-/);
        if (!match) continue;

        const code = match[1];
        const countryName = file.replace(/^[A-Z]{2}-/, '').replace(/\.md$/, '');
        const filePath = path.join(baseDir, file);
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const {data, content: body} = matter(raw);
        const meta = data as CountryMeta;

        content[code] = body;
        countries.push({code, name: countryName, markdown: body, meta});
      }

      (content as any)._countries = countries;
      (content as any)._meta = Object.fromEntries(
        countries.map(({code, meta}) => [code, meta]),
      );
      return content;
    },
    async contentLoaded({content, actions}) {
      actions.setGlobalData(content);

      const countries = (content as any)._countries as CountryContent[];
      const componentPath = path.resolve(__dirname, '../src/pages/compliance-country.tsx');
      for (const {code, markdown} of countries) {
        actions.addRoute({
          path: `${baseUrl}compliance/${code.toLowerCase()}`,
          component: componentPath,
          exact: true,
          props: {
            countryCode: code,
            markdown,
          },
        });
      }
    },
  };
}
