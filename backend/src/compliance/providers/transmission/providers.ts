import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { TransmissionProvider } from './transmission-provider';

/** Email is the only channel with a real implementation today (MailService). */
export class EmailTransmissionProvider implements TransmissionProvider {
  readonly id = 'email';
  readonly channel: ChannelType = 'EMAIL';
  readonly feedback = 'NONE' as const;
  transmit(artifacts: SignedArtifact[], ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/email', `send ${artifacts.length} artifact(s) to ${ctx.buyer.legalName} via MailService (key ${key})`);
    return { channel: 'EMAIL', status: 'SENT', notes: ['stub: wire to MailService.sendMail'] };
  }
}

export class PeppolTransmissionProvider implements TransmissionProvider {
  readonly id = 'peppol';
  readonly channel: ChannelType = 'PEPPOL';
  readonly feedback = 'ASYNC_CALLBACK' as const; // Peppol Invoice Response / MLR
  transmit(_artifacts: SignedArtifact[], ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/peppol', `SMP lookup for ${ctx.buyer.peppolId ?? '(no peppolId)'} + AS4 send (key ${key})`);
    return { channel: 'PEPPOL', status: ctx.buyer.peppolId ? 'SENT' : 'SKIPPED', notes: ['stub: integrate a Peppol Access Point'] };
  }
  sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/peppol', `push lifecycle status "${status}" to Peppol for ${ref}`);
    return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: [`stub: relay "${status}" via Peppol Invoice Response`] };
  }
}

/** France — Plateforme de Dématérialisation Partenaire (+ PPF annuaire routing). */
export class PdpTransmissionProvider implements TransmissionProvider {
  readonly id = 'pdp';
  readonly channel: ChannelType = 'PDP';
  readonly feedback = 'ASYNC_CALLBACK' as const; // PDP pushes lifecycle statuses (déposée/refusée/encaissée)
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pdp', `annuaire lookup + deliver to recipient PDP + push e-reporting (key ${key})`);
    return { channel: 'PDP', status: 'SENT', notes: ['stub: integrate a registered PDP'] };
  }
  sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pdp', `push lifecycle status "${status}" to the PDP for ${ref}`);
    return { channel: 'PDP', status: 'QUEUED', ref, notes: [`stub: relay "${status}" via registered PDP`] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pdp', `poll PDP lifecycle statuses for ${ref}`);
    return { channel: 'PDP', status: 'PENDING', ref, notes: [] };
  }
}

/** Mexico — Proveedor Autorizado de Certificación (blocking clearance → returns folio/UUID). */
export class PacTransmissionProvider implements TransmissionProvider {
  readonly id = 'pac';
  readonly channel: ChannelType = 'PAC';
  readonly feedback = 'ASYNC_POLL' as const; // poll PAC for SAT clearance result
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pac', `submit to PAC for SAT clearance, await UUID/folio fiscal (key ${key})`);
    return { channel: 'PAC', status: 'PENDING', notes: ['stub: integrate a PAC; clearance is asynchronous'] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pac', `poll PAC clearance result for ${ref}`);
    return { channel: 'PAC', status: 'PENDING', ref, notes: [] };
  }
}

/** Italy — Sistema di Interscambio. */
export class SdiTransmissionProvider implements TransmissionProvider {
  readonly id = 'sdi';
  readonly channel: ChannelType = 'SDI';
  readonly feedback = 'ASYNC_CALLBACK' as const; // SdI notifiche (consegnata/scartata…)
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `submit FatturaPA to SdI, await receipt/notifica (key ${key})`);
    return { channel: 'SDI', status: 'PENDING', notes: ['stub: integrate SdI'] };
  }
  sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `push lifecycle status "${status}" to SdI for ${ref}`);
    return { channel: 'SDI', status: 'QUEUED', ref, notes: [`stub: relay "${status}" via SdI`] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `poll SdI notifiche for ${ref}`);
    return { channel: 'SDI', status: 'PENDING', ref, notes: [] };
  }
}

/** Generic government portal/API. Use a dedicated provider (below) when the system has specifics. */
export class GovPortalTransmissionProvider implements TransmissionProvider {
  readonly id = 'gov-portal';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/gov-portal', `submit to government clearance/reporting API (key ${key})`);
    return { channel: 'GOV_PORTAL_API', status: 'PENDING', notes: ['stub: integrate the national portal'] };
  }
}

/** Poland — Krajowy System e-Faktur. A GOV_PORTAL_API system selected via ChannelSpec.providerId='ksef'. */
export class KsefTransmissionProvider implements TransmissionProvider {
  readonly id = 'ksef';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const; // poll KSeF for the UPO / reference number
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/ksef', `authenticate (token/seal) + submit FA_VAT to KSeF, await KSeF reference number (key ${key})`);
    return { channel: 'GOV_PORTAL_API', status: 'PENDING', notes: ['stub: integrate KSeF'] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/ksef', `poll KSeF UPO/status for ${ref}`);
    return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [] };
  }
}

/** Peru / generic — Operador de Servicios Electrónicos. */
export class OseTransmissionProvider implements TransmissionProvider {
  readonly id = 'ose';
  readonly channel: ChannelType = 'OSE';
  readonly feedback = 'ASYNC_POLL' as const; // await the CDR
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/ose', `submit to OSE, await CDR (key ${key})`);
    return { channel: 'OSE', status: 'PENDING', notes: ['stub: integrate an OSE'] };
  }
}

/** Physical print (B2C mandates: CL, many LATAM, SA simplified). */
export class PrintTransmissionProvider implements TransmissionProvider {
  readonly id = 'print';
  readonly channel: ChannelType = 'PRINT';
  readonly feedback = 'NONE' as const;
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/print', `produce printable representation with QR (key ${key})`);
    return { channel: 'PRINT', status: 'SENT', notes: ['stub: generate printable PDF/receipt'] };
  }
}
