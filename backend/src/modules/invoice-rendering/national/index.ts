/**
 * National XML builders — registry of country-code → skeleton builder.
 *
 * Dispatched by InvoiceRenderingService.buildNationalXml(); countries without a
 * dedicated builder fall back to buildGenericNationalXml().
 */
import type { InvoiceRenderData } from '../render-data';

import {
  buildClDte,
  buildArFe,
  buildEcFe,
  buildBrNfe,
  buildCrFe,
  buildDoEcf,
  buildGtFel,
  buildPaFe,
  buildPyDe,
  buildSvDte,
  buildUyCfe,
  buildVeFe,
  buildBoFe,
} from './latam-builders';
import {
  buildCnEfapiao,
  buildInIrp,
  buildIdEfaktur,
  buildTwEgui,
  buildKzEsf,
  buildPhEis,
  buildThEtax,
  buildNpCbms,
  buildBdNbr,
  buildPkFbr,
  buildVnTt78,
  buildMyInvois,
} from './asia-builders';
import { buildTrEfatura, buildEgEta, buildJoJofotara, buildTnTeif } from './mena-builders';
import {
  buildGrMydata,
  buildHuSzM,
  buildUaTaxinvoice,
  buildMeFiscal,
  buildHrEracun,
  buildAlFiscalization,
} from './europe-builders';
import {
  buildNgFirs,
  buildKeEtims,
  buildGhEvat,
  buildRwEbm,
  buildTzVfd,
  buildUgEfris,
  buildZmSmartInvoice,
  buildZwFdms,
  buildCiFne,
  buildBjMecef,
} from './africa-builders';

/** Country-code → national XML skeleton builder (pure `data → string` functions). */
export const NATIONAL_XML_BUILDERS: Record<string, (d: InvoiceRenderData) => string> = {
  CL: buildClDte,
  AR: buildArFe,
  EC: buildEcFe,
  BR: buildBrNfe,
  TR: buildTrEfatura,
  CN: buildCnEfapiao,
  EG: buildEgEta,
  IN: buildInIrp,
  GR: buildGrMydata,
  HU: buildHuSzM,
  // LATAM — added by §1.3 scaffold
  CR: buildCrFe,
  DO: buildDoEcf,
  GT: buildGtFel,
  PA: buildPaFe,
  PY: buildPyDe,
  SV: buildSvDte,
  UY: buildUyCfe,
  VE: buildVeFe,
  BO: buildBoFe,
  // Asia — added by §1.3 scaffold
  ID: buildIdEfaktur,
  TW: buildTwEgui,
  KZ: buildKzEsf,
  PH: buildPhEis,
  TH: buildThEtax,
  NP: buildNpCbms,
  BD: buildBdNbr,
  PK: buildPkFbr,
  VN: buildVnTt78,
  MY: buildMyInvois,
  // MENA — added by §1.3 scaffold
  JO: buildJoJofotara,
  TN: buildTnTeif,
  // Europe-national — added by §1.3 scaffold
  UA: buildUaTaxinvoice,
  ME: buildMeFiscal,
  HR: buildHrEracun,
  AL: buildAlFiscalization,
  // Africa — added by §1.3 scaffold
  NG: buildNgFirs,
  KE: buildKeEtims,
  GH: buildGhEvat,
  RW: buildRwEbm,
  TZ: buildTzVfd,
  UG: buildUgEfris,
  ZM: buildZmSmartInvoice,
  ZW: buildZwFdms,
  CI: buildCiFne,
  BJ: buildBjMecef,
};
