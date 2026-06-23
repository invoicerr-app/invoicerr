# Invoicerr Documentation

This is the source for [docs.invoicerr.app](https://docs.invoicerr.app), built with [Docusaurus](https://docusaurus.io/).

## Installation

```bash
npm install
```

## Local development

```bash
npm start
```

Starts a local dev server with live reload at `http://localhost:3000`.

## Build

```bash
npm run build
```

Generates static content into the `build/` directory.

## Deployment

Deployment is automated via the `docs-deploy.yml` GitHub Actions workflow, which builds the site and publishes it to GitHub Pages on every push to the deploy branch. There is no manual deploy step.
