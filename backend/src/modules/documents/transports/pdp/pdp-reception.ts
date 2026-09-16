/**
 * PDP RECEPTION — the read side of the "pdp" transport. `pdp-transport.ts` only ever SENDS (this
 * company depositing an outbound invoice); this file is what lets an INBOUND deposit — an invoice a
 * supplier sent TO this company, arriving on the SAME superpdp account this company already connected
 * for sending — become a `received-invoice` `DocumentInstance`, and what lets the buyer-side lifecycle
 * status ("prise en charge", "approuvée"/"refusée", "payée" — the mandatory buyer statuses named by
 * DGFiP's own "Facturation électronique : guide pratique de démarrage au 1er septembre 2026",
 * `impots.gouv.fr`, Q12 "Que faire si l'acheteur refuse ma facture ?" — read as raw PDF text, not a
 * summarized fetch, per this repo's own "legal reading = raw text" discipline: the refusal status is
 * confirmed there as a REAL, motivated ("obligatoirement motivé") lifecycle status, distinct from a
 * platform-level format rejection) get reported back to the platform.
 *
 * ## What is LIVE-VERIFIED here, and what is not (2026-09-16, `pdp-reception.live.spec.ts`)
 *
 *  - `PdpClient.listInvoices({ direction: 'in' })` genuinely returns inbound deposits — proven by a
 *    SELF-ADDRESSED deposit (seller and buyer both this same sandbox tenant's own connected
 *    identifiers, `315143296_1422` / VAT `FR18000000002` / SIREN-ish `000000002`, exactly the
 *    "envoi vers notre propre SIREN" self-test the task named): the OUTBOUND id and the INBOUND
 *    twin the platform creates for it are two DIFFERENT ids, `direction=in` lists the SECOND one.
 *  - `PdpClient.downloadInvoiceFile()` genuinely returns the real bytes (`content-type:
 *    application/pdf`, real `%PDF-` magic bytes) — see that method's own header in `pdp-client.ts`
 *    for the wrong `/file` sub-path an earlier version of this code guessed and the real endpoint
 *    (`GET /v1.beta/invoices/{id}?format=original`, the SAME one `getInvoice()` already calls) found
 *    by testing live.
 *  - `PdpClient.pushLifecycleStatus()` — LIVE-VERIFIED NEGATIVE: every code below, pushed against a
 *    freshly deposited invoice's own "in" id, answered a generic, route-not-found-shaped `404` — see
 *    that method's own header for the full evidence (multiple path variants, all 404). The push
 *    functions below still call it (a real PA, unlike the free sandbox, may implement it) but NEVER
 *    let that failure become fatal — see `pushReceptionStatus` below.
 *
 * The exact fr:2xx CODE for each buyer-side status is the ONE thing this file cannot cite a verified
 * source for: `fr:205` ("accepted by buyer") is REPRISED from `pdp-client.ts`'s own pre-existing
 * header comment (itself never independently re-verified here — the push endpoint doesn't answer);
 * `fr:203`/`fr:206`/`fr:211` follow the SAME XP Z12-012 numbering pattern (200 deposited, 201 issued,
 * 202 received, …, 213 rejected) but are NOT confirmed against any spec text this session could reach
 * — superpdp.tech's own OpenAPI page is a client-rendered SPA that yields no body to an automated
 * fetch (confirmed again this session, same limitation `credentials-guide.md` already documents), and
 * no DGFiP source found names the raw numeric codes at all (the practical guide above discusses the
 * STATUSES by name and legal effect, never by code). Marked `unverified` below, honestly, rather than
 * presented as researched fact — the same provenance discipline CLAUDE.md's country-data catalogs
 * already hold.
 */
import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { extractPdpCredentials } from '../pdp-transport';
import { PdpClient } from './pdp-client';

export const PDP_RECEPTION_PROVIDER_ID = 'pdp';

/** Reçue — emitted BY THE PLATFORM ITSELF the instant an inbound deposit reaches this company's own
 *  account (proven live on the "in" twin's own `events[0]`, `pdp-reception.live.spec.ts`) — this
 *  code is NEVER pushed by this codebase, only ever read (`pdp-reception-poller.ts`). */
export const PDP_RECEPTION_RECEIVED_CODE = 'fr:202';
/** Prise en charge — pushed automatically the moment this codebase has successfully imported the
 *  deposit as a `received-invoice` (`reception-sweep-runner.ts`). `kind: 'unverified'` — see this
 *  file's own header. */
export const PDP_RECEPTION_TAKEN_IN_CHARGE_CODE = 'fr:203';
/** Approuvée (par l'acheteur) — pushed by the "approve" action. `kind: 'unverified'`, though closer
 *  to sourced than the others: `pdp-client.ts`'s own pre-existing header already named this exact
 *  code "accepted by buyer" before this file existed. */
export const PDP_RECEPTION_APPROVED_CODE = 'fr:205';
/** Refusée (par l'acheteur) — pushed by the "reject" action, always with the user's own `reason` as
 *  `data.reason` on the push body: the DGFiP guide's own Q12 is explicit that this status is
 *  "obligatoirement motivé" — never fired without one. `kind: 'unverified'` — see this file's own
 *  header; no source named the numeric code itself. */
export const PDP_RECEPTION_REJECTED_CODE = 'fr:206';
/** Payée — pushed by "record-payment" once the recorded payment(s) reach the received invoice's own
 *  stated gross total. `fr:211` ("payment sent") rather than `fr:212` ("payment received") — see
 *  `pdp-client.ts`'s own header: `212` is the SELLER's own code once THEY are paid; this company is
 *  the BUYER here, so the code for the buyer's own act of paying is the one that applies.
 *  `kind: 'unverified'` numerically, same reasoning as the others. */
export const PDP_RECEPTION_PAID_CODE = 'fr:211';

/** What the received-invoice actions (`actions/received-invoice-actions.ts`) and the reception sweep
 *  (`conformity/reception-sweep-runner.ts`) both depend on — narrow on purpose, the same "depend on
 *  the interface, not the concrete class" discipline `DocumentActionQueueDispatcher`
 *  (`queue/queue.constants.ts`) already holds: a jest spec can pass a bare stub, no
 *  `ChannelCredentialsService`/Prisma/network involved at all. */
export interface PdpReceptionStatusPusher {
  pushTakenInCharge(companyId: string, pdpInboundId: string): Promise<void>;
  pushApproved(companyId: string, pdpInboundId: string): Promise<void>;
  pushRejected(companyId: string, pdpInboundId: string, reason?: string): Promise<void>;
  pushPaid(companyId: string, pdpInboundId: string): Promise<void>;
}

async function resolveClient(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<PdpClient | null> {
  const resolved = await channelCredentials.resolveActive(companyId, PDP_RECEPTION_PROVIDER_ID);
  const credentials = resolved && extractPdpCredentials(resolved);
  if (!credentials) return null;
  return new PdpClient({ ...credentials, apiStyle: 'superpdp' });
}

/**
 * Pushes ONE lifecycle code — NEVER fatal. A received-invoice's own local status change (the actual
 * legal/bookkeeping fact this company cares about) is always persisted BEFORE this is even called
 * (see each action's own handler) — a platform that cannot yet accept the push (proven true of the
 * sandbox today, see this file's own header) must never roll back, retry-block, or fail the user-facing
 * action that already succeeded locally. Logged at `warn` (not `error`): this is the DOCUMENTED,
 * expected-for-now outcome against the sandbox, not a surprise.
 */
async function pushReceptionStatus(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
  pdpInboundId: string,
  code: string,
  reason?: string,
): Promise<void> {
  const invoiceId = Number(pdpInboundId);
  if (!Number.isFinite(invoiceId)) return; // manually-uploaded received invoices have no PDP id at all
  try {
    const client = await resolveClient(channelCredentials, companyId);
    if (!client) {
      logger.warn('PDP reception status push skipped — channel not connected any more', {
        category: 'documents',
        details: { companyId, pdpInboundId, code },
      });
      return;
    }
    await client.pushLifecycleStatus(invoiceId, code);
    logger.info('PDP reception status pushed', {
      category: 'documents',
      details: { companyId, pdpInboundId, code },
    });
  } catch (error) {
    logger.warn(
      'PDP reception status push failed — non-fatal, the local status change is unaffected ' +
        '(see pdp-client.ts#pushLifecycleStatus for why this endpoint is not reachable on the sandbox today)',
      {
        category: 'documents',
        details: {
          companyId,
          pdpInboundId,
          code,
          reason,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
}

export function buildPdpReceptionStatusPusher(
  channelCredentials: ChannelCredentialsService,
): PdpReceptionStatusPusher {
  return {
    pushTakenInCharge: (companyId, pdpInboundId) =>
      pushReceptionStatus(channelCredentials, companyId, pdpInboundId, PDP_RECEPTION_TAKEN_IN_CHARGE_CODE),
    pushApproved: (companyId, pdpInboundId) =>
      pushReceptionStatus(channelCredentials, companyId, pdpInboundId, PDP_RECEPTION_APPROVED_CODE),
    pushRejected: (companyId, pdpInboundId, reason) =>
      pushReceptionStatus(channelCredentials, companyId, pdpInboundId, PDP_RECEPTION_REJECTED_CODE, reason),
    pushPaid: (companyId, pdpInboundId) =>
      pushReceptionStatus(channelCredentials, companyId, pdpInboundId, PDP_RECEPTION_PAID_CODE),
  };
}
