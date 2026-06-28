#!/usr/bin/env node
'use strict';

/**
 * Schematron → XSLT compiler for the EN16931 CII rules (vendored, reproducible).
 *
 * Pipeline to regenerate the validator used by `validateSchematron()`:
 *   1. Vendored source: EN16931-CII-validation.sch (+ -model/-syntax/-codes.sch) from
 *      ConnectingEurope/eInvoicing-EN16931.
 *   2. Preprocess (ISO Schematron abstract/include expansion) → EN16931-CII-validation-preprocessed.sch
 *      (the inlined `sch:let` / abstract patterns must already be expanded here — THIS compiler
 *       does NOT itself resolve <sch:let> variables, see LIMITATION below).
 *   3. node compile-schematron.cjs   → writes EN16931-CII-validation.xsl
 *   4. npx xslt3 -xsl:EN16931-CII-validation.xsl -export:EN16931-CII-validation.sef.json -nogo -t
 *      → the .sef.json consumed by saxon-js at runtime in validate.ts
 *
 * LIMITATION (be honest): this is a pragmatic, simplified compiler. It merges rules by context and
 * emits one template per context, but it does NOT implement <sch:let> variable binding. It therefore
 * relies on the preprocessed .sch having inlined them. It is a useful CI gate (it fires the real
 * EN16931 assertions and fails on broken/empty CII) but is NOT a certified-complete EN16931 validator
 * — some `let`-based rules may silently not fire. For authoritative certification use Mustang/KoSIT.
 */

const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

const SCH_PATH = path.join(__dirname, 'EN16931-CII-validation-preprocessed.sch');
const XSL_PATH = path.join(__dirname, 'EN16931-CII-validation.xsl');

// ── helpers ──────────────────────────────────────────────────────────
function escAttr(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escText(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getChildElements(parent, localName) {
  const results = [];
  if (!parent.childNodes) return results;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1 && child.localName === localName) {
      results.push(child);
    }
  }
  return results;
}

function getTextContent(node) {
  if (!node) return '';
  if (node.textContent !== undefined) return node.textContent;
  let text = '';
  if (node.childNodes) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType === 3 || c.nodeType === 4) text += c.nodeValue || '';
      else text += getTextContent(c);
    }
  }
  return text;
}

// ── strip leading "//" from context paths ────────────────────────────
function normalizeContext(ctx) {
  if (ctx.startsWith('//')) {
    return ctx.substring(2);
  }
  return ctx;
}

// ── parse ────────────────────────────────────────────────────────────
const schRaw = fs.readFileSync(SCH_PATH, 'utf-8');
const doc = new DOMParser({ xmlns: {} }).parseFromString(schRaw, 'text/xml');

const schemaEl = doc.getElementsByTagNameNS('http://purl.oclc.org/dsdl/schematron', 'schema')[0];
if (!schemaEl) {
  console.error('No <schema> element found');
  process.exit(1);
}

// ── collect namespace prefixes from <ns> elements ────────────────────
const nsEls = getChildElements(schemaEl, 'ns');
const nsMap = {};
for (const ns of nsEls) {
  const prefix = ns.getAttribute('prefix');
  const uri = ns.getAttribute('uri');
  if (prefix && uri) nsMap[prefix] = uri;
}

// ── collect patterns and rules, group by context ──────────────────────
const patterns = getChildElements(schemaEl, 'pattern');

// Map: normalizedContext → { asserts: [...], reports: [...] }
const contextMap = new Map();

let totalAsserts = 0;
let totalReports = 0;

for (const pattern of patterns) {
  const patternId = pattern.getAttribute('id') || '';
  const rules = getChildElements(pattern, 'rule');

  for (const rule of rules) {
    const rawContext = rule.getAttribute('context') || '';
    const context = normalizeContext(rawContext);

    if (!contextMap.has(context)) {
      contextMap.set(context, { asserts: [], reports: [], patternIds: [] });
    }
    const entry = contextMap.get(context);
    entry.patternIds.push(patternId);

    const asserts = getChildElements(rule, 'assert');
    for (const assertEl of asserts) {
      entry.asserts.push({
        test: assertEl.getAttribute('test') || '',
        id: assertEl.getAttribute('id') || '',
        flag: assertEl.getAttribute('flag') || rule.getAttribute('flag') || 'fatal',
        message: getTextContent(assertEl).trim()
      });
      totalAsserts++;
    }

    const reports = getChildElements(rule, 'report');
    for (const reportEl of reports) {
      entry.reports.push({
        test: reportEl.getAttribute('test') || '',
        id: reportEl.getAttribute('id') || '',
        flag: reportEl.getAttribute('flag') || rule.getAttribute('flag') || 'warning',
        message: getTextContent(reportEl).trim()
      });
      totalReports++;
    }
  }
}

// ── build XSLT ──────────────────────────────────────────────────────
const xsl = [];
function push(s) { xsl.push(s); }

push(`<?xml version="1.0" encoding="UTF-8"?>`);
push(`<xsl:stylesheet version="2.0"`);
push(`  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"`);
push(`  xmlns:svrl="http://purl.oclc.org/svl/svrl"`);
push(`  xmlns:saxon="http://saxon.sf.net/"`);

const sortedPrefixes = Object.keys(nsMap).sort();
for (const p of sortedPrefixes) {
  push(`  xmlns:${p}="${escAttr(nsMap[p])}"`);
}

push(`  exclude-result-prefixes="svrl saxon">`);
push('');

// ── root template ────────────────────────────────────────────────────
push(`<xsl:template match="/">`);
push(`  <svrl:schematron-output phase="#ALL" schemaVersion="">`);
push(`    <svrl:title>EN16931-CII-validation</svrl:title>`);
push(`    <xsl:apply-templates select="*" mode="svrl"/>`);
push(`  </svrl:schematron-output>`);
push(`</xsl:template>`);
push('');

// ── suppress non-element nodes in svrl mode ──────────────────────────
push(`<xsl:template match="text()" mode="svrl"/>`);
push(`<xsl:template match="comment()" mode="svrl"/>`);
push(`<xsl:template match="processing-instruction()" mode="svrl"/>`);

// ── traversal template: recurse into child ELEMENTS only ─────────────
push(`<xsl:template match="*" mode="svrl">`);
push(`  <xsl:apply-templates select="*" mode="svrl"/>`);
push(`</xsl:template>`);
push('');

// ── emit ONE template per unique context (merged from all patterns) ──
let ruleIndex = 0;
for (const [context, entry] of contextMap) {
  ruleIndex++;
  const priority = ruleIndex + 100; // well above default 0.5

  push(`<!-- Context: ${escAttr(context)} [${entry.patternIds.join(', ')}] -->`);
  push(`<xsl:template match="${escAttr(context)}" mode="svrl" priority="${priority}">`);

  // Emit all asserts for this context
  for (const a of entry.asserts) {
    push(`  <xsl:if test="not(${a.test})">`);
    push(`    <svrl:failed-assert id="${escAttr(a.id)}" flag="${escAttr(a.flag)}" location="saxon:path()">`);
    push(`      <svrl:text>${escText(a.message)}</svrl:text>`);
    push(`    </svrl:failed-assert>`);
    push(`  </xsl:if>`);
  }

  // Emit all reports for this context
  for (const r of entry.reports) {
    push(`  <xsl:if test="${r.test}">`);
    push(`    <svrl:successful-report id="${escAttr(r.id)}" flag="${escAttr(r.flag)}" location="saxon:path()">`);
    push(`      <svrl:text>${escText(r.message)}</svrl:text>`);
    push(`    </svrl:successful-report>`);
    push(`  </xsl:if>`);
  }

  // KEY: Continue traversal into children
  push(`  <xsl:apply-templates select="*" mode="svrl"/>`);

  push(`</xsl:template>`);
  push('');
}

push(`</xsl:stylesheet>`);

// ── write XSLT ──────────────────────────────────────────────────────
const xslContent = xsl.join('\n');
fs.writeFileSync(XSL_PATH, xslContent, 'utf-8');

const uniqueContexts = contextMap.size;
console.log(`XSLT generated: ${XSL_PATH}`);
console.log(`  File size: ${(Buffer.byteLength(xslContent) / 1024).toFixed(1)} KB`);
console.log(`  Patterns: ${patterns.length}`);
console.log(`  Unique contexts: ${uniqueContexts}`);
console.log(`  Total asserts: ${totalAsserts}`);
console.log(`  Total reports: ${totalReports}`);
