import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import {GlobExcludeDefault} from '@docusaurus/utils';
import complianceContentPlugin from './plugins/compliance-content-plugin';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Invoicerr',
  tagline: 'Open-source invoicing for freelancers',
  // `favicon.svg` is the exact file the app itself ships (frontend/public/favicon.svg, copied
  // verbatim, not redrawn): it self-themes via an embedded `prefers-color-scheme` media query on a
  // `<style>` block, so a single file already answers both browser themes for every browser that
  // renders SVG favicons and evaluates `<style>` inside one. The `headTags` below add the same PNG
  // fallback pair the app's own index.html carries, for the narrower set of browsers that can't.
  favicon: 'img/favicon.svg',

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

  // Reproduces frontend/index.html's own favicon stack (identity "Lagune", decision 2026-09-15) so
  // the browser tab reads the same across the app and the docs: the `favicon` field above only ever
  // emits one unconditional `<link rel="icon">`, with no `type`/`sizes`/`media`, so the PNG fallback
  // pair — and its own dark-mode variants — have to be added by hand here. `media` picks the dark
  // pair only for browsers that resolve `media` on a `<link>` but can't render the self-theming SVG;
  // browsers that support neither fall through to the last, unscoped light pair. All hrefs are
  // absolute (`/img/...`) rather than run through `useBaseUrl` — config code has no such hook — which
  // is fine only because `baseUrl` above is `/`; revisit if that ever changes. The `theme-color` meta
  // pair is the same #f3f7f9/#0a1215 the app's own index.html carries (computed from --background,
  // not invented) so a mobile browser's own chrome tints to match whichever OS scheme is active.
  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        media: '(prefers-color-scheme: dark)',
        href: '/img/favicon-32-dark.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        media: '(prefers-color-scheme: dark)',
        href: '/img/favicon-16-dark.png',
      },
    },
    {
      tagName: 'link',
      attributes: {rel: 'icon', type: 'image/png', sizes: '32x32', href: '/img/favicon-32.png'},
    },
    {
      tagName: 'link',
      attributes: {rel: 'icon', type: 'image/png', sizes: '16x16', href: '/img/favicon-16.png'},
    },
    {
      tagName: 'link',
      attributes: {rel: 'apple-touch-icon', href: '/img/apple-touch-icon.png'},
    },
    {
      tagName: 'meta',
      attributes: {name: 'theme-color', content: '#f3f7f9', media: '(prefers-color-scheme: light)'},
    },
    {
      tagName: 'meta',
      attributes: {name: 'theme-color', content: '#0a1215', media: '(prefers-color-scheme: dark)'},
    },
  ],

  plugins: [
    complianceContentPlugin,
    // `/llms.txt` (an index of every page) and `/llms-full.txt` (every page's text in one file),
    // per https://llmstxt.org. Generated from the same markdown at each build, so it can't drift
    // from the site. The legal translations are excluded for the same reason the docs preset
    // excludes them below: they are backend content, not pages of this site.
    [
      'docusaurus-plugin-llms',
      {
        title: 'Invoicerr',
        description:
          'Open-source invoicing software (AGPL-3.0): quotes, invoices, payments and country e-invoicing for France, Germany, Italy, Poland and Portugal. Self-hosted with Docker, or hosted.',
        ignoreFiles: ['legal/*.{fr,de,it,pl,pt}.md'],
        includeOrder: ['user-guide/**', 'developer-guide/**', 'legal/**'],
        excludeImports: true,
        removeDuplicateHeadings: true,
      },
    ],
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
          // `docs/legal/<slug>.<lang>.md` (a translation sibling — see `backend/src/legal/legal-
          // documents.ts`'s own "Translations" header) is content for the backend's `GET /legal/
          // documents` API, never a second Docusaurus page: the site itself stayed English-only when
          // its own i18n locale was retired (2026-09-16, see this repo's CLAUDE.md), and generating an
          // `/docs/legal/privacy-policy.fr` route per translation would both contradict that decision
          // and pollute `legalSidebar`'s autogenerated listing (`sidebars.ts`) with entries no navbar
          // link points at. Spreading Docusaurus's own default `exclude` list rather than replacing it
          // keeps every other existing exclusion (test files, `_`-prefixed drafts) intact.
          exclude: [...GlobExcludeDefault, 'legal/*.{fr,de,it,pl,pt}.md'],
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
      // The logo lockup already carries the wordmark (frontend/public/brand/logo-full.svg), so the
      // navbar doesn't also need Docusaurus's separate text `title` next to it — that used to be the
      // only brand identifier while `logo.png` was a generic placeholder; keeping `title` alongside
      // the real wordmark would just repeat "Invoicerr" twice. `logo-white.svg` (the all-white
      // lockup, not `logo-full.svg`'s fixed ink+azure) is used for the dark navbar surface for the
      // same reason `BrandMark` never puts azure on azure (frontend/src/components/brand-mark.tsx's
      // own header): ink-on-dark reads as an illegible near-black smudge.
      logo: {
        alt: 'Invoicerr',
        src: 'img/brand/logo-full.svg',
        srcDark: 'img/brand/logo-white.svg',
        height: 28,
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
      // github's own background (#f6f8fa, HSL hue 210) already sits almost exactly on the Lagune
      // light palette's own background/surface hues (#f3f7f9/#fbfeff, HSL hue ~195-200) — no clash,
      // left as-is. dracula's background (#282a36) is HSL hue 231 — numerically close to the
      // identity's OKLCH hue 230, but OKLCH and HSL don't share a hue scale: in HSL terms that's a
      // muted PURPLE, next to a UI that is now blue-cyan (HSL ~196-210) everywhere else, which read
      // as a visible seam around every code block. nightOwl's background (#011627) is HSL hue 207 —
      // the same blue family the rest of the dark theme uses — so code blocks read as one more
      // panel of the same surface instead of a foreign inserted theme.
      theme: prismThemes.github,
      darkTheme: prismThemes.nightOwl,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
