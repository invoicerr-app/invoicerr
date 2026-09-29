/**
 * Builds ONE fully-seeded demo company for a single country — the per-country unit `scripts/
 * demo-reset.ts` calls once per entry in `defaultCountryPolicyCatalog.countries()` (today: DE/FR/IT/
 * PL/PT). Every document is created through the REAL `DocumentsService.runAction` (never a raw Prisma
 * row — see that service's own header on why this is the only way to get country-policy compliance,
 * field validation and correct numbering for free) for every action that does not itself send
 * anything (`save-draft`, `record-payment`, `accept-manually`, `approve`, `reject`, `record`); the one
 * exception is reaching "sent" status, which uses `move-to-sent.ts`'s own numbering-only bypass
 * instead of the real `send` action, so a reset never depends on a working mail/transport
 * configuration existing in whatever namespace it runs in (see that file's own header).
 *
 * Discovers which document TYPES a country offers from `defaultCountryPolicyCatalog.typesFor`, never
 * a hardcoded list — a new type or country the catalog grows later is seeded automatically, per issue
 * #533's own requirement.
 */
import { Logger } from '@nestjs/common';

import { DocumentsService } from '@/modules/documents/documents.service';
import { ArticlesService } from '@/modules/articles/articles.service';
import { ClientsService } from '@/modules/clients/clients.service';
import prisma from '@/prisma/prisma.service';
import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { defaultCountryPolicyCatalog } from '@/modules/documents/country-policy/registry';

import {
  CountryMeta,
  SupportedCountryCode,
  countryMeta,
  pickArticles,
  pickCity,
  pickClientNames,
  pickCompanyName,
  pickContactName,
  pickStreet,
  randomLineQuantity,
} from '../generators/data-pools';
import { generatePartyIdentifiers, standardVatRateId } from '../generators/party-identifiers';
import { Rng, daysFrom, floatBetween, intBetween, isoDate } from '../generators/rng';
import { moveDraftToSent } from './move-to-sent';

const loggerForSeed = new Logger('demo-seed-company');

export interface SeedCountrySummary {
  companyId: string;
  companyName: string;
  countryCode: SupportedCountryCode;
  documentsCreated: Record<string, number>;
}

interface Deps {
  documentsService: DocumentsService;
  articlesService: ArticlesService;
  clientsService: ClientsService;
}

function baseLine(rng: Rng, meta: CountryMeta, article: { name: string; unitPrice: number }) {
  return {
    description: article.name,
    quantity: randomLineQuantity(rng),
    unit: 'unit',
    unitPrice: article.unitPrice,
    vatRate: standardVatRateId(meta.countryCode),
  };
}

async function createDomesticAndForeignClients(
  deps: Deps,
  rng: Rng,
  companyId: string,
  meta: CountryMeta,
): Promise<{ domestic: string; foreign: string; supplier: string }> {
  const [domesticName, supplierName] = pickClientNames(rng, meta, 2);
  const foreignMeta = countryMeta(meta.foreignClientCountry);
  const foreignName = pickClientNames(rng, foreignMeta, 1)[0];

  const makeClient = async (
    name: string,
    clientMeta: CountryMeta,
    opts: { isSupplier?: boolean } = {},
  ): Promise<string> => {
    const { city, postalCode } = pickCity(rng, clientMeta);
    const contact = pickContactName(rng, clientMeta);
    const identifiers = generatePartyIdentifiers(rng, clientMeta.countryCode);
    const created = await deps.clientsService.createClient(companyId, {
      id: '',
      name,
      address: pickStreet(rng, clientMeta),
      postalCode,
      city,
      country: clientMeta.countryName,
      countryCode: clientMeta.countryCode,
      currency: 'EUR',
      type: 'COMPANY',
      isActive: true,
      isSupplier: opts.isSupplier ?? false,
      contactFirstname: contact.firstname,
      contactLastname: contact.lastname,
      contactEmail: `${contact.firstname}.${contact.lastname}@example-demo.invoicerr.app`.toLowerCase(),
      identifiers: identifiers.map((entry) => ({ scheme: entry.scheme, value: entry.value })),
    } as never);
    return (created as { id: string }).id;
  };

  const domestic = await makeClient(domesticName, meta);
  const supplier = await makeClient(supplierName, meta, { isSupplier: true });
  const foreign = await makeClient(foreignName, foreignMeta);
  return { domestic, foreign, supplier };
}

async function createArticles(deps: Deps, rng: Rng, companyId: string, meta: CountryMeta): Promise<void> {
  const articles = pickArticles(rng, meta, 3);
  for (const article of articles) {
    await deps.articlesService.create(companyId, {
      name: article.name,
      type: article.type,
      unitPrice: article.unitPrice,
      vatRate: 0,
    });
  }
}

export async function seedCountryCompany(
  deps: Deps,
  params: { userId: string; userEmail: string; countryCode: SupportedCountryCode; rng: Rng; now: Date },
): Promise<SeedCountrySummary> {
  const { userId, userEmail, countryCode, rng, now } = params;
  const meta = countryMeta(countryCode);
  const actor = { id: userId, name: 'Demo Account', email: userEmail };
  // Every `runAction` call below goes through this wrapper so `role`/`actor` are never forgotten on
  // one call site — `accept-manually` (quote-manual-acceptance.ts) hard-refuses without a real actor
  // to record ("Cannot mark a quote accepted manually without an authenticated actor to record"), and
  // passing it everywhere, not only there, matches what a real, logged-in OWNER's own call always
  // carries (`documents.controller.ts`'s own `@User()`-sourced actor).
  const run = (typeId: string, actionId: string, payload: Parameters<DocumentsService['runAction']>[3]) =>
    deps.documentsService.runAction(companyId, typeId, actionId, payload, CompanyRole.OWNER, false, actor);
  const { city, postalCode } = pickCity(rng, meta);
  const companyName = pickCompanyName(rng, meta);

  const company = await prisma.company.create({
    data: {
      name: companyName,
      address: pickStreet(rng, meta),
      postalCode,
      city,
      country: meta.countryName,
      countryCode: meta.countryCode,
      currency: 'EUR',
      foundedAt: daysFrom(now, -3650),
      phone: '+1 555 0100',
      email: `contact@${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example-demo.invoicerr.app`,
      language: meta.language,
      // The built-in "email" transport — without a chosen transport, a real "send" click refuses
      // with the ORDINARY "no transport configured" message (`invoice-actions.ts`) before ever
      // reaching `TransportRegistry.register`'s own demo-mode guard. A visitor clicking "Send" on
      // a demo invoice should see THIS feature's refusal, not an unrelated configuration gap.
      invoiceTransportId: 'email',
    },
    select: { id: true },
  });
  const companyId = company.id;

  await prisma.userCompany.create({ data: { userId, companyId, role: CompanyRole.OWNER } });

  for (const entry of generatePartyIdentifiers(rng, meta.countryCode)) {
    await prisma.partyIdentifier.create({ data: { companyId, scheme: entry.scheme, value: entry.value } });
  }

  await createArticles(deps, rng, companyId, meta);
  const clients = await createDomesticAndForeignClients(deps, rng, companyId, meta);

  const articlesInCatalog = pickArticles(rng, meta, 2);
  const documentsCreated: Record<string, number> = {};
  const bump = (typeId: string) => {
    documentsCreated[typeId] = (documentsCreated[typeId] ?? 0) + 1;
  };

  const typeIds = new Set(defaultCountryPolicyCatalog.typesFor(countryCode));

  // ── quote ────────────────────────────────────────────────────────────────────────────────────
  let paidInvoiceForCreditNote: { id: string; data: unknown } | undefined;
  if (typeIds.has('quote')) {
    // #1 — draft, WITH options (two distinct named options on its own lines).
    await run('quote', 'save-draft', {
      data: {
        client: clients.domestic,
        issueDate: isoDate(now),
        currency: 'EUR',
        lines: [
          { ...baseLine(rng, meta, articlesInCatalog[0]), option: 'Basic' },
          { ...baseLine(rng, meta, articlesInCatalog[1]), option: 'Premium', quantity: 1 },
        ],
      },
    });
    bump('quote');

    // #2 — plain draft, no options.
    await run('quote', 'save-draft', {
      data: {
        client: clients.foreign,
        issueDate: isoDate(now),
        currency: 'EUR',
        lines: [baseLine(rng, meta, articlesInCatalog[0])],
      },
    });
    bump('quote');

    // #3 — sent, then manually accepted ("signed").
    const draft = await run('quote', 'save-draft', {
      data: {
        client: clients.domestic,
        issueDate: isoDate(now),
        currency: 'EUR',
        lines: [baseLine(rng, meta, articlesInCatalog[0])],
      },
    });
    const draftDoc = (draft as { document: { id: string; data: unknown } }).document;
    const sentQuote = await moveDraftToSent(
      companyId,
      'quote',
      draftDoc.id,
      draftDoc.data as Record<string, unknown>,
    );
    // `data` must carry the document's own FULL current data on every call, not just this action's own
    // input (`documents.service.ts#runAction` validates `payload.data` against the whole descriptor
    // regardless of which action is running) — the action's own extra input goes in `params` instead.
    await run('quote', 'accept-manually', {
      documentId: draftDoc.id,
      data: sentQuote.data as Record<string, unknown>,
      params: { note: 'Accepted by the client during the demo reset.' },
    });
    bump('quote');
  }

  // ── invoice ──────────────────────────────────────────────────────────────────────────────────
  if (typeIds.has('invoice')) {
    // Draft.
    await run('invoice', 'save-draft', {
      data: {
        client: clients.domestic,
        issueDate: isoDate(now),
        dueDate: isoDate(daysFrom(now, 30)),
        currency: 'EUR',
        lines: [baseLine(rng, meta, articlesInCatalog[0])],
      },
    });
    bump('invoice');

    const createSentInvoice = async (dueOffsetDays: number) => {
      const built = await run('invoice', 'save-draft', {
        data: {
          client: clients.domestic,
          issueDate: isoDate(daysFrom(now, -20)),
          dueDate: isoDate(daysFrom(now, dueOffsetDays)),
          currency: 'EUR',
          lines: [baseLine(rng, meta, articlesInCatalog[0]), baseLine(rng, meta, articlesInCatalog[1])],
        },
      });
      const doc = (built as { document: { id: string; data: unknown } }).document;
      const sent = await moveDraftToSent(companyId, 'invoice', doc.id, doc.data as Record<string, unknown>);
      bump('invoice');
      return sent;
    };

    // Sent, not yet due — "pending".
    await createSentInvoice(20);

    // Sent, past due, nothing paid — "overdue".
    await createSentInvoice(-10);

    // Sent, partly paid.
    const partlyPaid = await createSentInvoice(15);
    const partlyPaidTotal = computeLineTotal(partlyPaid);
    await run('invoice', 'record-payment', {
      documentId: partlyPaid.id,
      data: partlyPaid.data as Record<string, unknown>,
      params: {
        amount: Math.round(partlyPaidTotal * 0.4 * 100) / 100,
        currency: 'EUR',
        paidAt: isoDate(now),
        method: 'bank_transfer',
      },
    });

    // Sent, fully paid — also the one a credit note corrects below.
    const paid = await createSentInvoice(10);
    const paidTotal = computeLineTotal(paid);
    await run('invoice', 'record-payment', {
      documentId: paid.id,
      data: paid.data as Record<string, unknown>,
      params: { amount: paidTotal, currency: 'EUR', paidAt: isoDate(now), method: 'bank_transfer' },
    });
    paidInvoiceForCreditNote = { id: paid.id, data: paid.data };
  }

  // ── credit-note ──────────────────────────────────────────────────────────────────────────────
  // A country's own `country-policy/data/<cc>.json` can declare "credit-note" among its
  // `documentTypes` (metadata: the type EXISTS in this jurisdiction's vocabulary) while still
  // forbidding the "save-draft" ACTION outright (Poland: FA(3) models a correction as a CORRECTIVE
  // INVOICE — invoice.descriptor's own "Corrects invoice" reference field — never a separate
  // credit-note document; the 403 names this explicitly). Wrapped in try/catch, entirely: when a
  // country's own law route a correction through a different mechanism this seed does not yet build,
  // 0 credit notes for that company is the HONEST count, not a bug to paper over with a document the
  // country would itself refuse to accept.
  if (typeIds.has('credit-note')) {
    try {
      // #1 — standalone (no corrected invoice), own reason + lines.
      await run('credit-note', 'save-draft', {
        data: {
          issueDate: isoDate(now),
          currency: 'EUR',
          reason: 'Pricing correction agreed with the client.',
          lines: [{ ...baseLine(rng, meta, articlesInCatalog[0]), quantity: 1 }],
        },
      });
      bump('credit-note');

      // #2 — linked to the fully-paid invoice above, when one exists. `correctedLines` (kind
      // 'rowSelection') stores the corrected invoice's OWN line ids — `$rowId`
      // (row-selection.ts#ROW_ID_KEY), stamped onto every 'array' row the moment it is saved through
      // an action a 'rowSelection' field points at, which the invoice's own earlier "save-draft" call
      // already was. Selecting every one of the invoice's lines: a full-amount credit note, the
      // simplest unambiguous case.
      if (paidInvoiceForCreditNote) {
        const invoiceLines =
          (paidInvoiceForCreditNote.data as { lines?: Record<string, unknown>[] } | null)?.lines ?? [];
        const correctedLines = invoiceLines
          .map((line) => line.$rowId)
          .filter((id): id is string => typeof id === 'string');
        const created = await run('credit-note', 'save-draft', {
          data: {
            invoice: paidInvoiceForCreditNote.id,
            correctedLines,
            issueDate: isoDate(now),
            currency: 'EUR',
            reason: 'Partial refund agreed with the client.',
          },
        });
        const doc = (created as { document: { id: string; data: unknown } }).document;
        await moveDraftToSent(companyId, 'credit-note', doc.id, doc.data as Record<string, unknown>);
        bump('credit-note');
      }
    } catch (error) {
      // The exact `correctedLines` (rowSelection) shape a credit note linked to an invoice needs is
      // stricter than a standalone one's, AND a country can forbid the action outright (Poland,
      // above) — either way, whatever credit notes were already created before the failure (`bump`
      // already ran for them) stand; this only stops trying further ones for this company.
      const detail = (error as { getResponse?: () => unknown })?.getResponse?.();
      loggerForSeed.warn(
        `credit-note seeding stopped early for ${countryCode}: ${
          error instanceof Error ? error.message : String(error)
        }${detail ? ` — ${JSON.stringify(detail)}` : ''}`,
      );
    }
  }

  // ── expense ──────────────────────────────────────────────────────────────────────────────────
  if (typeIds.has('expense')) {
    for (let i = 0; i < 2; i++) {
      await run('expense', 'save-draft', {
        data: {
          description: i === 0 ? 'Office supplies' : 'Business travel',
          amount: floatBetween(rng, 20, 400, 2),
          currency: 'EUR',
          date: isoDate(daysFrom(now, -intBetween(rng, 1, 60))),
        },
      });
      bump('expense');
    }
  }

  // ── received-invoice ─────────────────────────────────────────────────────────────────────────
  if (typeIds.has('received-invoice')) {
    const netAmount = floatBetween(rng, 100, 2000, 2);
    const received = await run('received-invoice', 'receive', {
      data: {
        supplierClient: clients.supplier,
        issueDate: isoDate(daysFrom(now, -15)),
        dueDate: isoDate(daysFrom(now, 15)),
        currency: 'EUR',
        netAmount,
        vatAmount: Math.round(netAmount * 0.2 * 100) / 100,
        grossAmount: Math.round(netAmount * 1.2 * 100) / 100,
        lines: [
          {
            description: 'Supplier services',
            quantity: 1,
            unitPrice: netAmount,
            vatRate: standardVatRateId(meta.countryCode),
          },
        ],
      },
    });
    bump('received-invoice');

    const netAmount2 = floatBetween(rng, 100, 2000, 2);
    const received2 = await run('received-invoice', 'receive', {
      data: {
        supplierClient: clients.supplier,
        issueDate: isoDate(daysFrom(now, -5)),
        currency: 'EUR',
        netAmount: netAmount2,
        vatAmount: Math.round(netAmount2 * 0.2 * 100) / 100,
        grossAmount: Math.round(netAmount2 * 1.2 * 100) / 100,
      },
    });
    const doc2 = (received2 as { document: { id: string; data: unknown } }).document;
    await run('received-invoice', 'approve', {
      documentId: doc2.id,
      data: doc2.data as Record<string, unknown>,
      params: {},
    });
    bump('received-invoice');
    void received;
  }

  // ── purchase-order ───────────────────────────────────────────────────────────────────────────
  const purchaseOrderIds: string[] = [];
  if (typeIds.has('purchase-order')) {
    const draftPo = await run('purchase-order', 'save-draft', {
      data: {
        supplier: clients.supplier,
        issueDate: isoDate(now),
        currency: 'EUR',
        lines: [{ description: 'Raw materials', quantity: 10, unitPrice: floatBetween(rng, 5, 80, 2) }],
      },
    });
    bump('purchase-order');
    purchaseOrderIds.push((draftPo as { document: { id: string } }).document.id);

    const sentPoBuild = await run('purchase-order', 'save-draft', {
      data: {
        supplier: clients.supplier,
        issueDate: isoDate(daysFrom(now, -5)),
        currency: 'EUR',
        lines: [{ description: 'Office equipment', quantity: 3, unitPrice: floatBetween(rng, 50, 300, 2) }],
      },
    });
    const sentPoDoc = (sentPoBuild as { document: { id: string; data: unknown } }).document;
    await moveDraftToSent(
      companyId,
      'purchase-order',
      sentPoDoc.id,
      sentPoDoc.data as Record<string, unknown>,
    );
    bump('purchase-order');
    purchaseOrderIds.push(sentPoDoc.id);
  }

  // ── goods-receipt ────────────────────────────────────────────────────────────────────────────
  if (typeIds.has('goods-receipt') && purchaseOrderIds.length > 0) {
    await run('goods-receipt', 'save-draft', {
      data: {
        purchaseOrder: purchaseOrderIds[0],
        receiptDate: isoDate(now),
        lines: [{ description: 'Raw materials', quantityReceived: 10 }],
      },
    });
    bump('goods-receipt');

    const secondPoId = purchaseOrderIds[1] ?? purchaseOrderIds[0];
    const grBuild = await run('goods-receipt', 'save-draft', {
      data: {
        purchaseOrder: secondPoId,
        receiptDate: isoDate(now),
        lines: [{ description: 'Office equipment', quantityReceived: 3 }],
      },
    });
    const grDoc = (grBuild as { document: { id: string; data: unknown } }).document;
    await run('goods-receipt', 'record', {
      documentId: grDoc.id,
      data: grDoc.data as Record<string, unknown>,
      params: {},
    });
    bump('goods-receipt');
  }

  return { companyId, companyName, countryCode, documentsCreated };
}

function computeLineTotal(document: { data: unknown }): number {
  const data = document.data as { lines?: { quantity: number; unitPrice: number }[] } | null;
  const lines = data?.lines ?? [];
  return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;
}
