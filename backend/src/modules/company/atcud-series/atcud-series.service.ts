/**
 * Portugal's ATCUD — the settings-screen store for the AT "código de validação" a company obtains,
 * per (série documentaire × tipo de documento), from the Portal das Finanças (AT FAQ 4308/4312, quoted
 * verbatim in `documents/country-policy/data/pt.json`'s own `invoice.send` notes). Shaped after
 * `SigningCertificatesService` (list/upsert/delete, `prisma` singleton, no injected `PrismaService`)
 * with ONE deliberate difference: the validation code is NOT a secret (see this file's header on
 * `upsert` for why), so there is nothing here to encrypt and nothing this service ever has to redact
 * out of its own responses.
 *
 * `documents/actions/atcud-issuance.ts` is the OTHER reader of this same table — it queries
 * `prisma.companyAtcudSeries` directly rather than through this service, the same "documents/ reaches
 * Prisma directly, company/ services exist for the settings screen" split every other credential-ish
 * store in this codebase already holds (e.g. `SigningCertificatesService` vs.
 * `documents/signing/sign-instance-pdf.ts`).
 */
import { Injectable } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { ATCUD_MIN_VALIDATION_CODE_LENGTH } from '@/modules/documents/numbering/atcud';
import { CompanyAtcudSeries } from '../../../../prisma/generated/prisma/client';

export interface AtcudSeriesResponse {
  id: string;
  companyId: string;
  typeId: string;
  seriesId: string;
  validationCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAtcudSeriesBody {
  typeId: string;
  seriesId: string;
  validationCode: string;
}

/** A validation code is a plain alphanumeric string in every real AT-issued example found
 *  (e.g. "JCVPTS0J") — Portaria n.º 195/2020, art. 3.º n.º 1 itself only states a minimum LENGTH, not
 *  a charset, so this is a deliberate, narrower PRODUCT-level input rule (never attributed to the
 *  Portaria in the error message below), chosen to keep this free-text field impossible to turn into
 *  markup/script injection in the PDF footer it eventually feeds (`rendering/render-pdf.ts`'s own
 *  `footerText`, which already HTML-escapes defensively — this is instead about refusing garbage at
 *  the source, the settings screen, rather than merely neutralizing it downstream). */
const VALIDATION_CODE_SHAPE = /^[A-Za-z0-9]+$/;

function toResponse(row: CompanyAtcudSeries): AtcudSeriesResponse {
  return {
    id: row.id,
    companyId: row.companyId,
    typeId: row.typeId,
    seriesId: row.seriesId,
    validationCode: row.validationCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class AtcudSeriesService {
  /** List every ATCUD series code this company has registered — the validation code is returned IN
   *  FULL (it is not a secret, see this file's own header), unlike `SigningCertificatesService`'s own
   *  metadata-only list. */
  async listForCompany(companyId: string): Promise<AtcudSeriesResponse[]> {
    const rows = await prisma.companyAtcudSeries.findMany({
      where: { companyId },
      orderBy: [{ typeId: 'asc' }, { seriesId: 'asc' }],
    });
    return rows.map(toResponse);
  }

  /**
   * Upsert (by `[companyId, typeId, seriesId]`) one series' validation code. Validates the SAME
   * minimum length `numbering/atcud.ts#computeAtcud` re-checks at issuance time (so a company cannot
   * even SAVE a code that would later fail loudly on a real invoice) plus the alphanumeric shape this
   * file's own header explains — both throw a plain `Error`, turned into a 400 by the controller.
   */
  async upsert(companyId: string, body: UpsertAtcudSeriesBody): Promise<AtcudSeriesResponse> {
    const typeId = body.typeId?.trim();
    const seriesId = body.seriesId?.trim();
    const validationCode = body.validationCode?.trim();

    if (!typeId) throw new Error('typeId is required.');
    if (!seriesId) throw new Error('seriesId is required.');
    if (!validationCode) throw new Error('validationCode is required.');
    if (validationCode.length < ATCUD_MIN_VALIDATION_CODE_LENGTH) {
      throw new Error(
        `The AT validation code must be at least ${ATCUD_MIN_VALIDATION_CODE_LENGTH} characters ` +
          '(Portaria n.º 195/2020, art. 3.º n.º 1).',
      );
    }
    if (!VALIDATION_CODE_SHAPE.test(validationCode)) {
      throw new Error('The AT validation code must contain only letters and digits.');
    }

    const row = await prisma.companyAtcudSeries.upsert({
      where: { companyId_typeId_seriesId: { companyId, typeId, seriesId } },
      create: { companyId, typeId, seriesId, validationCode },
      update: { validationCode, updatedAt: new Date() },
    });
    return toResponse(row);
  }

  /** Hard delete, scoped by BOTH `id` AND `companyId` — a foreign company's row id simply matches
   *  nothing (count 0) rather than ever being reachable cross-tenant, the same discipline
   *  `SigningCertificatesService#deactivate` and `ChannelCredentialsService#deleteChannelConfig`
   *  already hold for their own single-row writes. A REAL delete (never soft, unlike a signing
   *  certificate): this is not audit-relevant credential history, it is a fact a company can simply
   *  re-enter if it deletes it by mistake — the exact same reasoning `CompanyChannelConfig`'s own
   *  DELETE already holds. */
  async remove(companyId: string, id: string): Promise<{ deleted: boolean }> {
    const { count } = await prisma.companyAtcudSeries.deleteMany({ where: { id, companyId } });
    return { deleted: count > 0 };
  }
}
