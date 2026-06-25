/**
 * One-off backfill for Company.countryCode / Client.countryCode.
 *
 * Scans rows where countryCode IS NULL, calls guessCountryCode(country) and
 * persists the result if it resolves.  Idempotent — running twice has no
 * effect on the second run.
 *
 * Usage (run from backend/, with DATABASE_URL set):
 *   npx tsx scripts/backfill-country-codes.ts
 * (tsx, not ts-node — the generated prisma-client uses .js import specifiers
 *  that ts-node's CJS resolver can't map to the .ts sources.)
 *
 * Never point this at a production database without manual verification first.
 */

import 'dotenv/config'
import { PrismaClient } from '../prisma/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { guessCountryCode } from '../src/utils/country-name-to-iso'

// This project's Prisma client is configured with a driver adapter (see
// src/prisma/prisma.service.ts) — it must be constructed with PrismaPg, not bare.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

interface Summary {
  table: string
  scanned: number
  resolved: number
  unresolved: number
}

async function backfillCompanies(): Promise<Summary> {
  const rows = await prisma.company.findMany({
    where: { countryCode: null },
    select: { id: true, country: true },
  })

  let resolved = 0
  for (const row of rows) {
    const code = guessCountryCode(row.country)
    if (code) {
      await prisma.company.update({
        where: { id: row.id },
        data: { countryCode: code },
      })
      resolved++
    }
  }

  return {
    table: 'Company',
    scanned: rows.length,
    resolved,
    unresolved: rows.length - resolved,
  }
}

async function backfillClients(): Promise<Summary> {
  const rows = await prisma.client.findMany({
    where: { countryCode: null },
    select: { id: true, country: true },
  })

  let resolved = 0
  for (const row of rows) {
    const code = guessCountryCode(row.country)
    if (code) {
      await prisma.client.update({
        where: { id: row.id },
        data: { countryCode: code },
      })
      resolved++
    }
  }

  return {
    table: 'Client',
    scanned: rows.length,
    resolved,
    unresolved: rows.length - resolved,
  }
}

async function main() {
  console.log('Backfilling country codes…\n')

  const summaries: Summary[] = []
  summaries.push(await backfillCompanies())
  summaries.push(await backfillClients())

  console.log('Done.\n')
  console.log('Table         Scanned   Resolved   Unresolved')
  console.log('─'.repeat(48))
  for (const s of summaries) {
    console.log(
      `${s.table.padEnd(14)} ${String(s.scanned).padStart(7)} ${String(s.resolved).padStart(9)} ${String(s.unresolved).padStart(11)}`
    )
  }

  const totalScanned = summaries.reduce((a, s) => a + s.scanned, 0)
  const totalResolved = summaries.reduce((a, s) => a + s.resolved, 0)
  const totalUnresolved = summaries.reduce((a, s) => a + s.unresolved, 0)
  console.log('─'.repeat(48))
  console.log(
    `${'Total'.padEnd(14)} ${String(totalScanned).padStart(7)} ${String(totalResolved).padStart(9)} ${String(totalUnresolved).padStart(11)}`
  )
  console.log()

  if (totalUnresolved > 0) {
    console.log(
      `${totalUnresolved} row(s) still have a NULL countryCode. These need a manual fix via Settings → Company / Clients.`
    )
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
