/**
 * The "invopop" transport - Invopop (`invopop.com`), a transmission platform registered by the DGFiP
 * and self-serve in sandbox. Same `DocumentTransport` interface `pdp-transport.ts` implements and
 * registered the same way (`TransportRegistry.register` - see that file's own header on why a company
 * opts in via `Company.invoiceTransportId` and why nothing here is special-cased).
 *
 * WHAT MAKES THIS ONE DIFFERENT FROM EVERY OTHER STRUCTURED TRANSPORT HERE: it does not deposit an
 * EN 16931 artifact at all. Invopop's API speaks GOBL, a JSON pivot model of its own, and converts to
 * each country's syntax INSIDE the workflow it runs. `invopop/gobl-invoice.ts` is that conversion and
 * its own header carries the full reasoning, including why GOBL is not registered in
 * `formats/format-registry.ts`. The practical consequence here is that this transport takes NO
 * `DocumentFormatProvider` dependency at all, unlike "pdp"/"ksef"/"sdi".
 *
 * THE DEPOSIT IS TWO WRITES, NOT ONE. There is no "send this invoice" endpoint: you PUT the GOBL
 * document into the SILO (which builds, validates and envelopes it) and then PUT a JOB that runs a
 * published WORKFLOW over that entry. The workflow is what numbers, signs, converts and transmits -
 * which is why `workflowId` is a REQUIRED credential below, next to the API key: without it there is
 * nothing to run, and an entry sitting in the silo has been transmitted nowhere.
 *
 * Two distinct failure shapes, both loud, neither silent - the same contract `pdp-transport.ts`
 * documents:
 *  - `preflight()` - no Invopop channel connected for this company, or a config missing the API key
 *    or the workflow id - thrown BEFORE anything is persisted or queued.
 *  - `send()` - connected, but the deposit itself fails (network/auth error, a GOBL validation
 *    refusal, a job that came back carrying faults, or a total the platform recomputed differently) -
 *    thrown from inside `deliver()`, so BullMQ's own retries get a chance to run before
 *    `send_failed` is ever recorded (`actions/async-send.ts`).
 *
 * THE HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md), applied to a
 * platform whose success signal is not a single status field:
 *  - An entry with an EMPTY id is a failure, never a silent success - a reference nobody can look up
 *    is not a reference.
 *  - A completed job carrying `faults` is a FAILURE even though its `status` reads `OK`. This is not
 *    defensive programming: Invopop's own documentation states that a job whose step failed and whose
 *    error branch then ran reports `status: "OK"` and still carries `faults`. Reading success off
 *    `status` is exactly the false green this repository has already been burned by twice.
 *  - A total the platform recomputed differently from this product's own is a failure. GOBL
 *    recalculates every total and, by its own documentation, "silently replaces" any supplied one
 *    with no error - so the only way to know the two engines agree is to compare what comes back.
 *  - A job still RUNNING when the wait elapses is NOT a failure: it is the deposit accepted and the
 *    verdict not yet in (Italy's SdI can take days). Following that verdict needs a poller
 *    (`conformity/pollers/`), which is separate work and is deliberately not guessed at here - the
 *    same named remainder `pdp-transport.ts`'s own header records for superpdp.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';
import { fromMinor } from '@/utils/financial';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { computeDocumentTotals } from '../totals/compute-totals';
import { GOBL_MIME, GoblLineInput, buildGoblInvoice } from './invopop/gobl-invoice';
import { InvopopClient, InvopopJob, InvopopSiloEntry } from './invopop/invopop-client';
import { invopopDeterministicId } from './invopop/invopop-ids';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

const PROVIDER_ID = 'invopop';

/** Same "the invoice's OWN base descriptor, module-level constant" choice `pdp-transport.ts` makes,
 *  for the identical reason: this transport is reached ONLY through `invoiceTransportId`, so it is
 *  always an invoice it builds a payload for, never another document type. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** Seconds the job PUT blocks waiting for the workflow to finish. Generous enough for the steps that
 *  answer in milliseconds (signing, numbering, PDF) without pretending to wait out the ones that take
 *  days (an authority's own verdict) - see this file's own header on why a still-running job is not a
 *  failure. */
const JOB_WAIT_SECONDS = 30;

export interface InvopopTransportDeps {
  channelCredentials: ChannelCredentialsService;
}

export interface InvopopCredentials {
  /** Optional - every workspace, sandbox or live, is served from the same host, and the TOKEN decides
   *  which one. Kept configurable only so a self-hoster can front the API with a proxy. */
  baseUrl?: string;
  apiKey: string;
  /** The PUBLISHED workflow this company's invoices run through - see this file's own header. */
  workflowId: string;
}

/** Extracts and validates the fields this transport actually needs out of a resolved config - shared
 *  by `preflight()` and `send()` so neither can drift from what "complete enough to try" means. */
export function extractInvopopCredentials(resolved: ResolvedChannelConfig): InvopopCredentials | null {
  const { baseUrl, apiKey, workflowId } = resolved.config;
  if (typeof apiKey !== 'string' || !apiKey.trim()) return null;
  if (typeof workflowId !== 'string' || !workflowId.trim()) return null;
  return {
    baseUrl: typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined,
    apiKey: apiKey.trim(),
    workflowId: workflowId.trim(),
  };
}

async function requireConnectedInvopop(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<InvopopCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractInvopopCredentials(resolved);
  if (!credentials) {
    logger.warn('Invopop transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The Invopop channel is not connected for this company. Connect it in company settings ' +
        '(Channels → Invopop) with an API key AND the id of a published workflow before sending an ' +
        'invoice through it - there is no default channel, and an entry with no workflow to run is ' +
        'transmitted nowhere.',
    );
  }
  return credentials;
}

/** Reads the built document's own payable total out of whichever shape the platform answered with. */
function builtPayable(entry: InvopopSiloEntry): string | undefined {
  const data = entry.data as { doc?: { totals?: { payable?: unknown } } } | undefined;
  const fromDoc = data?.doc?.totals?.payable;
  if (typeof fromDoc === 'string') return fromDoc;
  const fromSnippet = (entry.snippet as { payable?: unknown } | undefined)?.payable;
  return typeof fromSnippet === 'string' ? fromSnippet : undefined;
}

/** One line per fault, in the platform's own words - never paraphrased: the fault codes are what an
 *  operator searches the country guides for. */
function describeFaults(job: InvopopJob): string {
  return (job.faults ?? [])
    .map((f) => `${f.provider ?? '?'}/${f.code ?? '?'}: ${f.message ?? ''}`.trim())
    .join('; ');
}

export function buildInvopopTransport(deps: InvopopTransportDeps): DocumentTransport {
  return {
    // Runs BEFORE anything is persisted or queued - checks ONLY that a usable connection exists; the
    // actual deposit is attempted in `send()` below, at delivery time.
    async preflight(companyId: string): Promise<void> {
      await requireConnectedInvopop(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result - the company's configuration
      // could have changed in the (possibly long, retried) time between the two calls. Same reasoning
      // `pdp-transport.ts` already documents.
      const credentials = await requireConnectedInvopop(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const [company, client] = await Promise.all([
        prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
        // Scoped by companyId - `clientId` comes straight off the document's own `data.client` and is
        // never checked for existence at write time, so a bare `findUnique` would happily hand back
        // another tenant's client. Same guard, same reasoning, as `pdp-transport.ts`.
        clientId
          ? prisma.client.findFirst({
              where: { id: clientId, companyId: ctx.companyId },
              include: { partyIdentifiers: true },
            })
          : Promise.resolve(null),
      ]);
      if (!company) {
        throw new BadRequestException(`Company "${ctx.companyId}" not found.`);
      }
      if (!client) {
        throw new BadRequestException(
          `Cannot deposit to Invopop: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, data);
      // No default. A currency this transport picked for the document would reach the platform as a
      // fact the invoice never carried, and the payable check further down would still pass (both
      // engines would have computed the same numbers at the same precision), so a wrong-currency
      // invoice would go out with nothing to catch it. The descriptor makes `currency` required, so
      // this is unreachable for a document that passed validation - which is exactly why refusing
      // costs nothing and guessing costs a silent error.
      const currency = totals.currency || (typeof data.currency === 'string' ? data.currency : '');
      if (!currency) {
        throw new BadRequestException(
          `Cannot deposit to Invopop: the ${ctx.label.toLowerCase()} carries no currency, and this ` +
            "transport never picks one on a document's behalf.",
        );
      }

      const rawLines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
      // `data.lines[i]` and `totals.lines[i]` are the same row by index - the invoice descriptor has
      // exactly one qualifying line array, the same invariant `build-semantic-invoice.ts` relies on.
      const lines: GoblLineInput[] = rawLines.map((line, index) => ({
        description: typeof line.description === 'string' ? line.description : '',
        quantity: Number(line.quantity ?? 0),
        unit: typeof line.unit === 'string' ? line.unit : null,
        unitPrice: Number(line.unitPrice ?? 0),
        discountPercent: typeof line.discountPercent === 'number' ? line.discountPercent : null,
        vatRatePercent: totals.lines[index]?.vatRatePercent ?? null,
      }));

      // The document's own number, not a platform-assigned one: this product numbers its invoices
      // itself (`numbering/`), and a workflow step that numbered them a second time would make the
      // legal sequence this product is responsible for disagree with what was transmitted.
      const code = ctx.document.displayNumber ?? ctx.document.id;

      const goblInvoice = buildGoblInvoice({
        code,
        issueDate: typeof data.issueDate === 'string' ? data.issueDate : '',
        dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
        currency,
        seller: companyToFormatParty(company),
        buyer: clientToFormatParty(client),
        lines,
        notes: typeof data.notes === 'string' ? data.notes : null,
      });

      // Derived from the document, never random - see `invopop/invopop-ids.ts`'s own header: this is
      // what stops a BullMQ retry from becoming a SECOND deposit of the same invoice on a platform
      // that may already have handed the first one to a tax authority.
      const createdAtMs = ctx.document.createdAt?.getTime?.() ?? Date.now();
      const entryId = invopopDeterministicId(ctx.document.id, 'entry', createdAtMs);
      const jobId = invopopDeterministicId(ctx.document.id, 'job', createdAtMs);

      const invopop = new InvopopClient({ baseUrl: credentials.baseUrl, apiKey: credentials.apiKey });

      let entry: InvopopSiloEntry;
      let job: InvopopJob;
      try {
        entry = await invopop.putSiloEntry(entryId, goblInvoice);
        job = await invopop.putJob(jobId, {
          workflowId: credentials.workflowId,
          siloEntryId: entryId,
          waitSeconds: JOB_WAIT_SECONDS,
        });
        // Re-read AFTER the job: the workflow's own steps (sign, convert, transmit) write their
        // results back onto the entry, so the version fetched here is the one worth archiving, not the
        // one the first PUT answered with.
        entry = await invopop.getSiloEntry(entryId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Invopop deposit failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` - see async-send.ts's own header: BullMQ's retries get
        // a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`Invopop deposit failed: ${message}`);
      }

      const reference = entry?.id ? String(entry.id) : '';
      if (!reference) {
        // THE HARD-SUCCESS CONTRACT - an accepted write with no usable id is a FAILURE, never a
        // silent success: a reference nobody can look up on the platform is not a reference at all.
        throw new BadRequestException(
          'Invopop accepted the deposit but returned no silo entry id - treating this as a failed ' +
            'deposit, never a silent success.',
        );
      }

      if (job.faults && job.faults.length > 0) {
        // NOT read off `job.status`, which the platform itself documents as reading "OK" for a job
        // whose step failed and whose error branch then ran. See this file's own header.
        throw new BadRequestException(
          `Invopop ran the workflow but it reported faults: ${describeFaults(job)}. The invoice is ` +
            `stored as silo entry ${reference} and was NOT transmitted.`,
        );
      }

      // GOBL recalculates every total and silently replaces any supplied one, so the only way to know
      // the platform's arithmetic agrees with this product's own is to compare what came back.
      const expectedPayable = fromMinor(totals.grossMinor, currency);
      const actualPayable = builtPayable(entry);
      if (actualPayable !== undefined && Number(actualPayable) !== expectedPayable) {
        throw new BadRequestException(
          `Invopop recomputed this invoice's payable total as ${actualPayable} ${currency} where this ` +
            `invoice says ${expectedPayable} ${currency}. Refusing to treat a document the platform ` +
            'read differently as sent - GOBL replaces supplied totals silently, so a mismatch here is ' +
            'the only signal there is.',
        );
      }

      const completed = Boolean(job.completed_at);
      logger.info('Invopop deposit accepted', {
        category: 'documents',
        details: {
          companyId: ctx.companyId,
          documentId: ctx.document.id,
          entryId: reference,
          jobId: job.id,
          completed,
        },
      });

      // The conservable artifact is the SIGNED GOBL ENVELOPE the platform stored and handed back
      // (`entry.data` - `head` + `doc` + `sigs`), not the bare document this transport sent: the
      // signature and the platform's own normalisation are part of what was actually transmitted.
      // Falls back to the sent document only if the platform answered without one, so archiving never
      // silently preserves nothing.
      const archived = entry.data ?? goblInvoice;

      return {
        message: completed
          ? `Deposited to Invopop - silo entry ${reference}, workflow job ${job.id} completed with no ` +
            'faults.'
          : `Deposited to Invopop - silo entry ${reference}, workflow job ${job.id} still running after ` +
            `${JOB_WAIT_SECONDS}s. The deposit is accepted; the authority verdict is not in yet.`,
        reference,
        providerId: PROVIDER_ID,
        artifacts: [
          {
            role: 'gobl',
            mime: GOBL_MIME,
            bytes: Buffer.from(JSON.stringify(archived), 'utf8'),
          },
        ],
      };
    },
  };
}
