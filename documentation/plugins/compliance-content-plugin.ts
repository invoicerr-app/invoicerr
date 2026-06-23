import path from 'path';
import fs from 'fs';
import type {Plugin} from '@docusaurus/types';

interface CountryContent {
  code: string;
  name: string;
  markdown: string;
}

/**
 * Scans compliance markdown files from docs/compliance/ at build time.
 * Extracts country code from filename (FI-Finland.md → FI).
 * Generates routes /compliance/<country> dynamically.
 * Exposes content via global data for backward compatibility.
 */
export default function complianceContentPlugin(): Plugin<Record<string, string>> {
  return {
    name: 'compliance-content-plugin',
    async loadContent() {
      const baseDir = path.join(__dirname, '..', '..', 'docs', 'compliance');
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
        const markdown = await fs.promises.readFile(filePath, 'utf-8');

        content[code] = markdown;
        countries.push({code, name: countryName, markdown});
      }

      // Attach countries list to content for route generation
      (content as any)._countries = countries;
      return content;
    },
    async contentLoaded({content, actions}) {
      actions.setGlobalData(content);

      const countries = (content as any)._countries as CountryContent[];
      const componentPath = path.resolve(__dirname, '../src/pages/compliance-country.tsx');
      for (const {code, markdown} of countries) {
        actions.addRoute({
          path: `/compliance/${code.toLowerCase()}`,
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
