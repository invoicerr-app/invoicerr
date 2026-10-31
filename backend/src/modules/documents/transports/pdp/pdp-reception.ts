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
 * ## What is LIVE-VERIFIED here, and what is not (2026-09-16, `superpdp-reception.live.spec.ts`)
 *
 *  - `PdpClient.listInvoices({ direction: 'in' })` genuinely returns inbound deposits — proven by a
 *    SELF-ADDRESSED deposit (seller and buyer both this same sandbox tenant's own connected
 *    identifiers, `315143296_1422` / VAT `FR18000000002` / SIREN-ish `000000002`, exactly the
 *    "send to our own SIREN" self-test the task named): the OUTBOUND id and the INBOUND
 *    twin the platform creates for it are two DIFFERENT ids, `direction=in` lists the SECOND one.
 *  - `PdpClient.downloadInvoiceFile()` genuinely returns the real bytes (`content-type:
 *    application/pdf`, real `%PDF-` magic bytes) — see that method's own header in `pdp-client.ts`
 *    for the wrong `/file` sub-path an earlier version of this code guessed and the real endpoint
 *    (`GET /v1.beta/invoices/{id}?format=original`, the SAME one `getInvoice()` already calls) found
 *    by testing live.
 *  - `PdpClient.pushLifecycleStatus()` — the route and body now match SuperPDP's published OpenAPI
 *    (read 2026-10-31): `POST /v1.beta/invoice_events` with `{ invoice_id, status_code, details? }`.
 *    The old `POST /v1.beta/invoices/{id}/lifecycle_events` never existed on the API; every live
 *    attempt answered a generic route-not-found `404`, so no status was ever delivered. The push
 *    functions below keep their never-fatal contract (a local status change is persisted first) but
 *    a failed push is now logged at `error`, with the platform's own status and response body.
 *
 * The fr:2xx codes below come from SuperPDP's own read-side `status_code` schema, which documents
 * each one: `fr:204` acknowledged, `fr:205` accepted, `fr:206` partly accepted, `fr:210` refused,
 * `fr:211` payment sent. Its create-side enum (`status_code_create`) is narrower than the read-side
 * list and refuses `fr:203` (a platform-emitted status), so "prise en charge" is pushed as `fr:204`
 * and a buyer refusal as `fr:210`, never `fr:206` ("partly accepted"). Which code DGFiP's own
 * lifecycle expects for a buyer's "prise en charge" is still not named by any source this codebase
 * could reach — see `pdp-reception.ts`'s own per-constant notes.
 */
import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { extractPdpCredentials } from '../pdp-transport';
import { PdpApiError, PdpClient, SuperPdpStatusCreate } from './pdp-client';

export const PDP_RECEPTION_PROVIDER_ID = 'pdp';

/** Reçue — emitted BY THE PLATFORM ITSELF the instant an inbound deposit reaches this company's own
 *  account (proven live on the "in" twin's own `events[0]`, `superpdp-reception.live.spec.ts`) — this
 *  code is NEVER pushed by this codebase, only ever read (`pdp-reception-poller.ts`). */
export const PDP_RECEPTION_RECEIVED_CODE = 'fr:202';
/** Prise en charge — pushed automatically the moment this codebase has successfully imported the
 *  deposit as a `received-invoice` (`reception-sweep-runner.ts`). `fr:204` is the closest status the
 *  create enum accepts ("Acknowledged"); `fr:203` ("Made available") is platform-emitted and refused
 *  by `status_code_create`. Which code DGFiP expects for this buyer act is still unverified. */
export const PDP_RECEPTION_TAKEN_IN_CHARGE_CODE: SuperPdpStatusCreate = 'fr:204';
/** Approuvée (par l'acheteur) — pushed by the "approve" action. `fr:205` is documented by SuperPDP's
 *  own `status_code` schema as "Accepted". */
export const PDP_RECEPTION_APPROVED_CODE: SuperPdpStatusCreate = 'fr:205';
/** Refusée (par l'acheteur) — pushed by the "reject" action, always with the user's own `reason` in
 *  the event's `details[].reason` (MDT-113): the DGFiP guide's own Q12 is explicit that this status
 *  is "obligatoirement motivé" — never fired without one. `fr:210` is documented as "Refused";
 *  `fr:206`, used before, is "Partly accepted" and meant the wrong thing. */
export const PDP_RECEPTION_REJECTED_CODE: SuperPdpStatusCreate = 'fr:210';
/** Payée — pushed by "record-payment" once the recorded payment(s) reach the received invoice's own
 *  stated gross total. `fr:211` ("payment sent") rather than `fr:212` ("payment received") — see
 *  `pdp-client.ts`'s own header: `212` is the SELLER's own code once THEY are paid; this company is
 *  the BUYER here, so the code for the buyer's own act of paying is the one that applies. */
export const PDP_RECEPTION_PAID_CODE: SuperPdpStatusCreate = 'fr:211';

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
 * (see each action's own handler) — a platform that cannot accept the push must never roll back,
 * retry-block, or fail the user-facing action that already succeeded locally. A failure is logged at
 * `error` with the platform's own status and body, so it is visible in the logs instead of swallowed.
 */
async function pushReceptionStatus(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
  pdpInboundId: string,
  code: SuperPdpStatusCreate,
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
    await client.pushLifecycleStatus(invoiceId, code, reason);
    logger.info('PDP reception status pushed', {
      category: 'documents',
      details: { companyId, pdpInboundId, code },
    });
  } catch (error) {
    // Never fatal — the local status change was persisted before this ran — but never silent either:
    // a status the platform never received is a legal fact this company believes it reported.
    logger.error('PDP reception status push failed — the platform did not receive it', {
      category: 'documents',
      details: {
        companyId,
        pdpInboundId,
        code,
        reason,
        status: error instanceof PdpApiError ? error.status : undefined,
        response: error instanceof PdpApiError ? error.body : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
    });
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
