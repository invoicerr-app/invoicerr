/**
 * One-off backfill for *Minor integer columns (Phase 2 of Float→int migration).
 *
 * For every row in every money-bearing table, computes <field>Minor =
 * toMinor(<field>, currency) using the row's own currency (joining to the
 * parent Invoice/Quote/RecurringInvoice for child tables).
 *
 * Idempotent — re-computes every time so any drift between the Float and
 * Int columns is visible as inconsistent data, and a partial run is safe to
 * simply re-run to completion (updates are applied row-by-row, not wrapped in
 * a single transaction).
 *
 * Usage (run from backend/, with DATABASE_URL set):
 *   npx tsx scripts/backfill-minor-units.ts
 * (tsx, not ts-node — the generated prisma-client uses .js import specifiers
 *  that ts-node's CJS resolver can't map to the .ts sources.)
 *
 * Never point this at a production database without manual verification.
 */

import 'dotenv/config'
import { PrismaClient } from '../prisma/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { toMinor } from '../src/utils/financial'

// This project's Prisma client is configured with a driver adapter (see
// src/prisma/prisma.service.ts) — it must be constructed with PrismaPg, not bare.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

interface RowSummary {
  table: string
  rows: number
}

async function main() {
  console.log('Backfilling minor-unit columns…\n')

  const summaries: RowSummary[] = []

  // ── Quote ──
  const quotes = await prisma.quote.findMany({
    select: { id: true, totalHT: true, totalVAT: true, totalTTC: true, currency: true },
  })
  for (const q of quotes) {
    await prisma.quote.update({
      where: { id: q.id },
      data: {
        totalHTMinor: toMinor(q.totalHT, q.currency),
        totalVATMinor: toMinor(q.totalVAT, q.currency),
        totalTTCMinor: toMinor(q.totalTTC, q.currency),
      },
    })
  }
  summaries.push({ table: 'Quote', rows: quotes.length })

  // ── QuoteItem (currency from parent Quote) ──
  const quoteItems = await prisma.quoteItem.findMany({
    select: { id: true, unitPrice: true, quoteId: true },
  })
  if (quoteItems.length > 0) {
    const quoteIds = [...new Set(quoteItems.map((i) => i.quoteId))]
    const parentQuotes = await prisma.quote.findMany({
      where: { id: { in: quoteIds } },
      select: { id: true, currency: true },
    })
    const currencyMap = new Map(parentQuotes.map((q) => [q.id, q.currency]))
    for (const item of quoteItems) {
      const currency = currencyMap.get(item.quoteId) || 'EUR'
      await prisma.quoteItem.update({
        where: { id: item.id },
        data: { unitPriceMinor: toMinor(item.unitPrice, currency) },
      })
    }
  }
  summaries.push({ table: 'QuoteItem', rows: quoteItems.length })

  // ── Invoice ──
  const invoices = await prisma.invoice.findMany({
    select: { id: true, totalHT: true, totalVAT: true, totalTTC: true, currency: true },
  })
  for (const inv of invoices) {
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        totalHTMinor: toMinor(inv.totalHT, inv.currency),
        totalVATMinor: toMinor(inv.totalVAT, inv.currency),
        totalTTCMinor: toMinor(inv.totalTTC, inv.currency),
      },
    })
  }
  summaries.push({ table: 'Invoice', rows: invoices.length })

  // ── InvoiceItem (currency from parent Invoice) ──
  const invoiceItems = await prisma.invoiceItem.findMany({
    select: { id: true, unitPrice: true, invoiceId: true },
  })
  if (invoiceItems.length > 0) {
    const invoiceIds = [...new Set(invoiceItems.map((i) => i.invoiceId))]
    const parentInvoices = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, currency: true },
    })
    const currencyMap = new Map(parentInvoices.map((inv) => [inv.id, inv.currency]))
    for (const item of invoiceItems) {
      const currency = currencyMap.get(item.invoiceId) || 'EUR'
      await prisma.invoiceItem.update({
        where: { id: item.id },
        data: { unitPriceMinor: toMinor(item.unitPrice, currency) },
      })
    }
  }
  summaries.push({ table: 'InvoiceItem', rows: invoiceItems.length })

  // ── RecurringInvoice ──
  const recInvs = await prisma.recurringInvoice.findMany({
    select: { id: true, totalHT: true, totalVAT: true, totalTTC: true, currency: true },
  })
  for (const r of recInvs) {
    await prisma.recurringInvoice.update({
      where: { id: r.id },
      data: {
        totalHTMinor: toMinor(r.totalHT, r.currency),
        totalVATMinor: toMinor(r.totalVAT, r.currency),
        totalTTCMinor: toMinor(r.totalTTC, r.currency),
      },
    })
  }
  summaries.push({ table: 'RecurringInvoice', rows: recInvs.length })

  // ── RecurringInvoiceItem (currency from parent RecurringInvoice) ──
  const recItems = await prisma.recurringInvoiceItem.findMany({
    select: { id: true, unitPrice: true, recurringInvoiceId: true },
  })
  if (recItems.length > 0) {
    const recIds = [...new Set(recItems.map((i) => i.recurringInvoiceId))]
    const parentRecs = await prisma.recurringInvoice.findMany({
      where: { id: { in: recIds } },
      select: { id: true, currency: true },
    })
    const currencyMap = new Map(parentRecs.map((r) => [r.id, r.currency]))
    for (const item of recItems) {
      const currency = currencyMap.get(item.recurringInvoiceId) || 'EUR'
      await prisma.recurringInvoiceItem.update({
        where: { id: item.id },
        data: { unitPriceMinor: toMinor(item.unitPrice, currency) },
      })
    }
  }
  summaries.push({ table: 'RecurringInvoiceItem', rows: recItems.length })

  // ── Payment ──
  const payments = await prisma.payment.findMany({
    select: { id: true, totalPaid: true, invoiceId: true },
  })
  if (payments.length > 0) {
    const paymentInvoiceIds = [...new Set(payments.map((p) => p.invoiceId))]
    const paymentInvoices = await prisma.invoice.findMany({
      where: { id: { in: paymentInvoiceIds } },
      select: { id: true, currency: true },
    })
    const invoiceCurrencyMap = new Map(paymentInvoices.map((inv) => [inv.id, inv.currency]))
    for (const p of payments) {
      const currency = invoiceCurrencyMap.get(p.invoiceId) || 'EUR'
      await prisma.payment.update({
        where: { id: p.id },
        data: { totalPaidMinor: toMinor(p.totalPaid, currency) },
      })
    }
  }
  summaries.push({ table: 'Payment', rows: payments.length })

  // ── PaymentItem (currency from parent Invoice via Payment) ──
  const paymentItems = await prisma.paymentItem.findMany({
    select: { id: true, amountPaid: true, paymentId: true },
  })
  if (paymentItems.length > 0) {
    const paymentIds = [...new Set(paymentItems.map((i) => i.paymentId))]
    const parentPayments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      select: { id: true, invoiceId: true },
    })
    const paymentInvoiceMap = new Map(parentPayments.map((p) => [p.id, p.invoiceId]))
    const allInvoiceIds = [...new Set(parentPayments.map((p) => p.invoiceId))]
    const paymentInvoices = await prisma.invoice.findMany({
      where: { id: { in: allInvoiceIds } },
      select: { id: true, currency: true },
    })
    const invCurrencyMap = new Map(paymentInvoices.map((inv) => [inv.id, inv.currency]))
    for (const item of paymentItems) {
      const invId = paymentInvoiceMap.get(item.paymentId)
      const currency = (invId && invCurrencyMap.get(invId)) || 'EUR'
      await prisma.paymentItem.update({
        where: { id: item.id },
        data: { amountPaidMinor: toMinor(item.amountPaid, currency) },
      })
    }
  }
  summaries.push({ table: 'PaymentItem', rows: paymentItems.length })

  // ── Article ──
  const articles = await prisma.article.findMany({
    select: { id: true, unitPrice: true, companyId: true },
  })
  if (articles.length > 0) {
    const companyIds = [...new Set(articles.map((a) => a.companyId))]
    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, currency: true },
    })
    const companyCurrencyMap = new Map(companies.map((c) => [c.id, c.currency]))
    for (const a of articles) {
      const currency = companyCurrencyMap.get(a.companyId) || 'EUR'
      await prisma.article.update({
        where: { id: a.id },
        data: { unitPriceMinor: toMinor(a.unitPrice, currency) },
      })
    }
  }
  summaries.push({ table: 'Article', rows: articles.length })

  // ── Summary ──
  console.log('Done.\n')
  console.log('Table                  Rows')
  console.log('─'.repeat(36))
  let total = 0
  for (const s of summaries) {
    console.log(`${s.table.padEnd(22)} ${String(s.rows).padStart(8)}`)
    total += s.rows
  }
  console.log('─'.repeat(36))
  console.log(`${'Total'.padEnd(22)} ${String(total).padStart(8)}`)
  console.log()

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
