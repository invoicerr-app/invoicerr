import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import complianceContentPlugin from './plugins/compliance-content-plugin';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Invoicerr',
  tagline: 'Open-source invoicing for freelancers',
  favicon: 'img/favicon.png',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://docs.invoicerr.app',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'invoicerr-app', // Usually your GitHub org/user name.
  projectName: 'invoicerr', // Usually your repo name.

  onBrokenLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    localeConfigs: {
      en: {label: 'English'},
      fr: {label: 'Français'},
    },
  },

  plugins: [complianceContentPlugin],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/invoicerr-app/invoicerr/tree/main/documentation/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Invoicerr',
      logo: {
        alt: 'Invoicerr Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'gettingStartedSidebar',
          label: 'Getting Started',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'developerGuideSidebar',
          label: 'Developer Guide',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiReferenceSidebar',
          label: 'API Reference',
          position: 'left',
        },
        {
          to: '/compliance',
          label: 'Compliance',
          position: 'left',
        },
        {
          type: 'doc',
          docId: 'changelog',
          label: 'Changelog',
          position: 'left',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: 'https://github.com/invoicerr-app/invoicerr',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started/introduction',
            },
            {
              label: 'Developer Guide',
              to: '/docs/developer-guide/architecture',
            },
            {
              label: 'Compliance',
              to: '/compliance',
            },
            {
              label: 'Changelog',
              to: '/docs/changelog',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub Issues',
              href: 'https://github.com/invoicerr-app/invoicerr/issues',
            },
            {
              label: 'Translations (Weblate)',
              href: 'https://hosted.weblate.org/engage/invoicerr/',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/invoicerr-app/invoicerr',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Invoicerr. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
