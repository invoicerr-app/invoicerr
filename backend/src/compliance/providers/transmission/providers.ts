import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { TransmissionProvider } from './transmission-provider';

/** Email is the only channel with a real implementation today (MailService). */
export class EmailTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'EMAIL';
  transmit(artifacts: SignedArtifact[], ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/email', `send ${artifacts.length} artifact(s) to ${ctx.buyer.legalName} via MailService (key ${key})`);
    return { channel: 'EMAIL', status: 'SENT', notes: ['stub: wire to MailService.sendMail'] };
  }
}

export class PeppolTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'PEPPOL';
  transmit(_artifacts: SignedArtifact[], ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/peppol', `SMP lookup for ${ctx.buyer.peppolId ?? '(no peppolId)'} + AS4 send (key ${key})`);
    return { channel: 'PEPPOL', status: ctx.buyer.peppolId ? 'SENT' : 'SKIPPED', notes: ['stub: integrate a Peppol Access Point'] };
  }
}

/** France — Plateforme de Dématérialisation Partenaire (+ PPF annuaire routing). */
export class PdpTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'PDP';
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pdp', `annuaire lookup + deliver to recipient PDP + push e-reporting (key ${key})`);
    return { channel: 'PDP', status: 'SENT', notes: ['stub: integrate a registered PDP'] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pdp', `poll PDP lifecycle statuses for ${ref}`);
    return { channel: 'PDP', status: 'PENDING', ref, notes: [] };
  }
}

/** Mexico — Proveedor Autorizado de Certificación (blocking clearance → returns folio/UUID). */
export class PacTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'PAC';
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
  readonly channel: ChannelType = 'SDI';
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `submit FatturaPA to SdI, await receipt/notifica (key ${key})`);
    return { channel: 'SDI', status: 'PENDING', notes: ['stub: integrate SdI'] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `poll SdI notifiche for ${ref}`);
    return { channel: 'SDI', status: 'PENDING', ref, notes: [] };
  }
}

/** Generic government portal/API (ZATCA, DIAN, KSeF, SEFAZ, etc.). */
export class GovPortalTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/gov-portal', `submit to government clearance/reporting API (key ${key})`);
    return { channel: 'GOV_PORTAL_API', status: 'PENDING', notes: ['stub: integrate the national portal'] };
  }
}

/** Peru / generic — Operador de Servicios Electrónicos. */
export class OseTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'OSE';
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/ose', `submit to OSE, await CDR (key ${key})`);
    return { channel: 'OSE', status: 'PENDING', notes: ['stub: integrate an OSE'] };
  }
}

/** Physical print (B2C mandates: CL, many LATAM, SA simplified). */
export class PrintTransmissionProvider implements TransmissionProvider {
  readonly channel: ChannelType = 'PRINT';
  transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/print', `produce printable representation with QR (key ${key})`);
    return { channel: 'PRINT', status: 'SENT', notes: ['stub: generate printable PDF/receipt'] };
  }
}
