/**
 * The RECEPTION poller for PDP — the read side of `pdp-status-poller.ts`'s own write-status-of-what-
 * WE-sent role. Same "one small interface, resolved from `ChannelCredentialsService`" shape as that
 * file, deliberately NOT an `AuthorityStatusPoller` (`authority-status-poller.ts`): that interface
 * polls the CURRENT VERDICT of one document THIS company already deposited (`poll(companyId,
 * transportRef)` — one document in, its own events out); reception is the opposite direction
 * entirely — LIST every inbound deposit this company's own connected PDP account currently holds,
 * for documents this company never created a `DocumentInstance` for yet. Forcing that into
 * `AuthorityStatusPoller`'s shape would mean inventing a fake `transportRef` for a document that does
 * not exist yet, which is backwards — a genuinely different interface, used by
 * `reception-sweep-runner.ts` instead of `ConformitySweepRunner`, is the honest shape.
 *
 * See `transports/pdp/pdp-reception.ts`'s own header for what is LIVE-VERIFIED here (list + download)
 * and `pdp-client.ts#downloadInvoiceFile`'s own header for the exact endpoint this reads.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { extractPdpCredentials } from '../../transports/pdp-transport';
import { PdpClient, SuperPdpInvoice } from '../../transports/pdp/pdp-client';
import { extractReceivedInvoiceFields, ExtractionResult } from '../../received-invoices/extraction';
import { extFor } from '../../received-invoices/storage';
import { PDP_RECEPTION_PROVIDER_ID } from '../../transports/pdp/pdp-reception';

export interface PdpInboundFile {
  bytes: Buffer;
  mime: string;
  fileName: string;
  extraction: ExtractionResult;
}

export interface ReceptionPoller {
  readonly providerId: string;
  /** Every inbound deposit THIS company's own connected account currently holds — an EMPTY array,
   *  never a throw, when the channel isn't connected for this company (the sweep runner treats that
   *  identically to "nothing to import this pass", the same posture `AuthorityStatusPollerRegistry`'s
   *  own header describes for "sdi"'s permanent absence — a company simply not using this channel is
   *  not an error). */
  listInbound(companyId: string): Promise<SuperPdpInvoice[]>;
  /** The one deposit's own original file bytes, downloaded, and run through the SAME structural
   *  extraction the manual upload screen uses (`received-invoices/extraction.ts`) — reused verbatim,
   *  never a second, PDP-specific field mapper: a PDP-sourced received-invoice and a manually-uploaded
   *  one both end up going through the identical CII/UBL/Factur-X reader, so they behave identically
   *  (same warnings, same supplier-VAT extraction) from this point on. A synthetic `fileName` is built
   *  from the platform's own `content-type` (`extFor`, `received-invoices/storage.ts`) purely so
   *  `extractReceivedInvoiceFields`'s own filename-sniffing branch (`.xml`/`.pdf`) has something to
   *  read — the ACTUAL bytes/mime are what decide the outcome, never the synthetic name alone.
   */
  downloadAndExtract(companyId: string, pdpInboundId: number): Promise<PdpInboundFile>;
}

export interface PdpReceptionPollerDeps {
  channelCredentials: ChannelCredentialsService;
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

export function buildPdpReceptionPoller(deps: PdpReceptionPollerDeps): ReceptionPoller {
  return {
    providerId: PDP_RECEPTION_PROVIDER_ID,

    async listInbound(companyId: string): Promise<SuperPdpInvoice[]> {
      const client = await resolveClient(deps.channelCredentials, companyId);
      if (!client) return [];
      // `limit: 50` — the sweep's own dedup (reception-sweep-runner.ts) scans this company's already-
      // imported received-invoices up to the SAME 500-row budget `received-invoices.service.ts`'s own
      // upload-dedup check already uses; a page of 50 fresh inbound deposits per pass, at the sweep's
      // own repeat interval, comfortably drains any realistic backlog without a bespoke pagination
      // loop, the same "bounded, honest linear check, not a hot path" reasoning that file's own header
      // gives for its own limit.
      const { data } = await client.listInvoices({ direction: 'in', limit: 50 });
      return data;
    },

    async downloadAndExtract(companyId: string, pdpInboundId: number): Promise<PdpInboundFile> {
      const client = await resolveClient(deps.channelCredentials, companyId);
      if (!client) {
        throw new Error(
          `PDP reception: channel not connected for company ${companyId} — cannot download deposit ` +
            `${pdpInboundId}.`,
        );
      }
      const file = await client.downloadInvoiceFile(pdpInboundId, 'original');
      const fileName = `pdp-inbound-${pdpInboundId}.${extFor(file.contentType)}`;
      const extraction = await extractReceivedInvoiceFields(file.bytes, file.contentType, fileName);
      return { bytes: file.bytes, mime: file.contentType, fileName, extraction };
    },
  };
}
