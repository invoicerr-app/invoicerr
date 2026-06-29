/**
 * Dedicated (stubbed) format providers for national clearance/reporting syntaxes.
 *
 * Each entry replaces a country's reliance on the generic `NATIONAL_XML` catch-all with a *named*
 * provider whose `log.todo(...)` points at the exact national schema to implement (names verified
 * against documentation/compliance/*.md). The catch-all `NationalXmlFormatProvider` stays registered as the
 * safety net for any country not yet graduated to a dedicated provider.
 *
 * Adding the real bytes = filling one `build()`/`validate()` body; nothing else in the pipeline
 * changes because the engine selects a provider purely by `DocumentSyntax`.
 */
import { PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, ValidationReport } from '../../execution/types';
import { ArtifactRole, DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';

interface NationalFormatSpec {
  /** Stable provider id, e.g. 'nfe', 'cl-dte'. */
  id: string;
  /** The DocumentSyntax this provider builds (1:1 with the profile's FormatSpec.syntax). */
  syntax: DocumentSyntax;
  /** Human label used in stub messages / validation warnings. */
  label: string;
  /** What the real `build()` must produce (authority schema, signature, key fields). */
  buildHint: string;
  /** What the real `validate()` must check (XSD / business rules). */
  validateHint?: string;
}

/** Turns a spec into a full FormatProvider whose body is a precise TODO. */
function nationalFormat(spec: NationalFormatSpec): FormatProvider {
  return {
    id: spec.id,
    supports: (syntax: DocumentSyntax) => syntax === spec.syntax,
    build(artifact: PlannedArtifact, _ctx, _plan, log: ComplianceLogger): Promise<RenderedArtifact> {
      log.todo(`format/${spec.id}`, spec.buildHint);
      return Promise.resolve({
        role: artifact.role as ArtifactRole,
        syntax: spec.syntax,
        mime: 'application/xml',
        bytes: new Uint8Array(),
      });
    },
    validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
      log.todo(`format/${spec.id}`, spec.validateHint ?? `validate ${spec.label} against its national schema`);
      return { valid: true, errors: [], warnings: [`${spec.label} validation not implemented (stub)`] };
    },
  };
}

export const NATIONAL_FORMAT_PROVIDERS: FormatProvider[] = [
  // --- LATAM ---
  nationalFormat({ id: 'ar-fe', syntax: 'AR_FE', label: 'Argentina Factura Electrónica', buildHint: 'build ARCA/AFIP WSFE comprobante + request CAE; embed CAE + vencimiento' }),
  nationalFormat({ id: 'bo-fe', syntax: 'BO_FE', label: 'Bolivia Facturación Electrónica', buildHint: 'build SIN XML + compute CUF/CUFD; sign' }),
  nationalFormat({ id: 'nfe', syntax: 'NFE', label: 'Brazil NF-e family', buildHint: 'build SEFAZ NF-e/NFC-e/NFS-e/NFCom/CT-e XML (chNFe 44-char access key, ICP-Brasil XMLDSig)', validateHint: 'validate against the NF-e XSD + SEFAZ business rules' }),
  nationalFormat({ id: 'cl-dte', syntax: 'CL_DTE', label: 'Chile DTE', buildHint: 'build SII DTE (TipoDTE 33/34/52/61) consuming a CAF folio; sign' }),
  nationalFormat({ id: 'cr-fe', syntax: 'CR_FE', label: 'Costa Rica Factura Electrónica v4.4', buildHint: 'build Hacienda XML v4.4 (clave numérica 50 dígitos) + QR' }),
  nationalFormat({ id: 'do-ecf', syntax: 'DO_ECF', label: 'Dominican Republic e-CF', buildHint: 'build DGII e-CF XML (e-NCF) + sign' }),
  nationalFormat({ id: 'ec-fe', syntax: 'EC_FE', label: 'Ecuador comprobantes electrónicos', buildHint: 'build SRI comprobante XML + clave de acceso (49 dígitos); sign' }),
  nationalFormat({ id: 'gt-fel', syntax: 'GT_FEL', label: 'Guatemala FEL', buildHint: 'build SAT FEL DTE XML; sign + certify via certificador' }),
  nationalFormat({ id: 'pa-fe', syntax: 'PA_FE', label: 'Panama FE/CF', buildHint: 'build DGI Factura Electrónica (FE/CF) XML + CUFE' }),
  nationalFormat({ id: 'py-de', syntax: 'PY_DE', label: 'Paraguay e-Kuatia DE', buildHint: 'build SIFEN Documento Electrónico (DE) XML + CDC; sign' }),
  nationalFormat({ id: 'sv-dte', syntax: 'SV_DTE', label: 'El Salvador DTE (JSON)', buildHint: 'build MH DTE JSON (códigoGeneración, numeroControl, selloRecibido); sign' }),
  nationalFormat({ id: 'uy-cfe', syntax: 'UY_CFE', label: 'Uruguay CFE/DFE', buildHint: 'build DGI CFE XML (e-Factura/e-Ticket) + sign' }),
  nationalFormat({ id: 've-fe', syntax: 'VE_FE', label: 'Venezuela Factura Electrónica', buildHint: 'build SENIAT XML; sign' }),
  // --- MENA ---
  nationalFormat({ id: 'jo-jofotara', syntax: 'JO_JOFOTARA', label: 'Jordan JoFotara', buildHint: 'build ISTD JoFotara national e-invoice XML + QR' }),
  nationalFormat({ id: 'tn-teif', syntax: 'TN_TEIF', label: 'Tunisia TEIF', buildHint: 'build TEIF XML for El Fatoura / TTN; sign' }),
  // --- Sub-Saharan Africa (fiscal-device real-time) ---
  nationalFormat({ id: 'ng-firs', syntax: 'NG_FIRS', label: 'Nigeria FIRS e-invoice', buildHint: 'build FIRS MBS payload + IRN/QR' }),
  nationalFormat({ id: 'ke-etims', syntax: 'KE_ETIMS', label: 'Kenya eTIMS', buildHint: 'build KRA eTIMS payload (OSCU/VSCU); device signature + QR' }),
  nationalFormat({ id: 'gh-evat', syntax: 'GH_EVAT', label: 'Ghana E-VAT', buildHint: 'build GRA E-VAT payload + QR/short-link' }),
  nationalFormat({ id: 'rw-ebm', syntax: 'RW_EBM', label: 'Rwanda EBM', buildHint: 'build RRA EBM payload; device signature' }),
  nationalFormat({ id: 'tz-vfd', syntax: 'TZ_VFD', label: 'Tanzania VFD', buildHint: 'build TRA VFD payload + verification code/QR' }),
  nationalFormat({ id: 'ug-efris', syntax: 'UG_EFRIS', label: 'Uganda EFRIS', buildHint: 'build URA EFRIS payload + FDN/QR' }),
  nationalFormat({ id: 'zm-smartinvoice', syntax: 'ZM_SMARTINVOICE', label: 'Zambia Smart Invoice', buildHint: 'build ZRA Smart Invoice payload; device signature' }),
  nationalFormat({ id: 'zw-fdms', syntax: 'ZW_FDMS', label: 'Zimbabwe FDMS', buildHint: 'build ZIMRA FDMS fiscal payload + verification QR' }),
  nationalFormat({ id: 'ci-fne', syntax: 'CI_FNE', label: 'Ivory Coast FNE', buildHint: 'build DGI FNE (SIGF) normalized e-invoice + sticker/QR' }),
  nationalFormat({ id: 'bj-mecef', syntax: 'BJ_MECEF', label: 'Benin e-MECeF', buildHint: 'build DGI e-MECeF payload + MECeF code/QR' }),
  // --- Asia ---
  nationalFormat({ id: 'id-efaktur', syntax: 'ID_EFAKTUR', label: 'Indonesia e-Faktur', buildHint: 'build DGT e-Faktur / Coretax XML + approval code' }),
  nationalFormat({ id: 'tw-egui', syntax: 'TW_EGUI', label: 'Taiwan eGUI', buildHint: 'build NRA eGUI (MIG) unified-invoice XML + invoice-number track' }),
  nationalFormat({ id: 'kz-esf', syntax: 'KZ_ESF', label: 'Kazakhstan ESF', buildHint: 'build IS ESF XML (virtual warehouse linkage); sign' }),
  nationalFormat({ id: 'ph-eis', syntax: 'PH_EIS', label: 'Philippines EIS', buildHint: 'build BIR EIS JSON; sign' }),
  nationalFormat({ id: 'th-etax', syntax: 'TH_ETAX', label: 'Thailand e-Tax Invoice', buildHint: 'build RD e-Tax Invoice & e-Receipt XML (PKCS#7 / digital signature)' }),
  nationalFormat({ id: 'np-cbms', syntax: 'NP_CBMS', label: 'Nepal CBMS', buildHint: 'build IRD CBMS payload (central billing monitoring)' }),
  nationalFormat({ id: 'bd-nbr', syntax: 'BD_NBR', label: 'Bangladesh NBR e-invoice', buildHint: 'build NBR e-invoice payload' }),
  nationalFormat({ id: 'pk-fbr', syntax: 'PK_FBR', label: 'Pakistan FBR XIR', buildHint: 'build FBR XIR payload + IRN/QR' }),
  // --- Europe (national, non-EN/Peppol) ---
  nationalFormat({ id: 'ua-taxinvoice', syntax: 'UA_TAXINVOICE', label: 'Ukraine tax-invoice', buildHint: 'build DPS tax-invoice XML for ЄРПН registration; qualified signature' }),
  nationalFormat({ id: 'me-fiscal', syntax: 'ME_FISCAL', label: 'Montenegro fiscalization', buildHint: 'build fiscalization XML (IKOF/JIKR) + QR' }),
  nationalFormat({ id: 'hr-eracun', syntax: 'HR_ERACUN', label: 'Croatia e-Račun', buildHint: 'build Fiscalization 2.0 e-Račun (EN 16931 / CIUS-HR) for the CIS' }),
  nationalFormat({ id: 'al-fiscalization', syntax: 'AL_FISCALIZATION', label: 'Albania fiscalization', buildHint: 'build CIS fiscalization XML (UBL-based) + NIVF/NSLF + QR' }),
  // --- Added with the dev docs merge (new clearance majors with a national schema) ---
  nationalFormat({ id: 'cn-efapiao', syntax: 'CN_EFAPIAO', label: 'China e-Fapiao', buildHint: 'build the fully-digitalized e-Fapiao XML (Golden Tax System IV) — the XML is the legal invoice' }),
  nationalFormat({ id: 'in-irp', syntax: 'IN_IRP', label: 'India GST e-invoice', buildHint: 'build the GST INV-01 JSON for the IRP; receive IRN + signed QR' }),
  nationalFormat({ id: 'vn-tt78', syntax: 'VN_TT78', label: 'Vietnam TT78 e-invoice', buildHint: 'build the TT78/Decree-123 e-invoice XML; apply the mandatory digital signature (token/HSM)' }),
  nationalFormat({ id: 'tr-efatura', syntax: 'TR_EFATURA', label: 'Turkey UBL-TR', buildHint: 'build UBL-TR e-Fatura (registered buyer) or e-Arşiv (unregistered); sign' }),
  nationalFormat({ id: 'eg-eta', syntax: 'EG_ETA', label: 'Egypt ETA e-invoice', buildHint: 'build the ETA e-invoice document (signed JSON/XML) + UUID' }),
];
