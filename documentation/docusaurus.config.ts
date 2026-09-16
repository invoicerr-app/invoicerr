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

  onBrokenLinks: 'throw',

  // The docs used to ship an i18n (French) locale, generated via Weblate — retired 2026-09-16: the
  // site is English-only now. Even without internationalization, this field is still useful to set
  // metadata like html lang.
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    complianceContentPlugin,
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        indexDocs: true,
        indexBlog: true,
        indexPages: false,
        hashed: true,
        language: ['en'],
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/invoicerr-app/invoicerr/tree/main/documentation/',
        },
        blog: {
          path: 'changelog',
          routeBasePath: '/changelog',
          showReadingTime: false,
          postsPerPage: 20,
          onUntruncatedBlogPosts: 'ignore',
          truncateMarker: /{\/\* truncate \*\/}/,
          feedOptions: {
            type: 'atom',
            title: 'Invoicerr Changelog',
          },
          blogTitle: 'Changelog',
          blogSidebarTitle: 'Latest releases',
          blogSidebarCount: 10,
        },
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
          sidebarId: 'userGuideSidebar',
          label: 'User Guide',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'developerGuideSidebar',
          label: 'Developer Guide',
          position: 'left',
        },
        {
          to: '/compliance',
          label: 'Compliance',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'legalSidebar',
          label: 'Legal',
          position: 'left',
        },
        {
          to: '/changelog',
          label: 'Changelog',
          position: 'left',
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
              label: 'User Guide',
              to: '/docs/user-guide/introduction',
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
              to: '/changelog',
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
