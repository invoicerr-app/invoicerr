/**
 * National format providers — one file per country under `national/`.
 *
 * Each entry replaces a country's reliance on the generic `NATIONAL_XML` catch-all with a
 * named provider whose `log.todo(...)` points at the exact national schema to implement
 * (names verified against documentation/compliance/*.md). The catch-all
 * `NationalXmlFormatProvider` stays registered as the safety net for any country not yet
 * graduated to a dedicated provider.
 *
 * Adding the real bytes = filling one `build()`/`validate()` body; nothing else in the
 * pipeline changes because the engine selects a provider purely by `DocumentSyntax`.
 */
import { FormatProvider } from './format-provider';
import { NationalFormatSpec, nationalFormat } from './national-format-spec';
import { AR_FE_FORMAT } from './national/ar-fe';
import { BO_FE_FORMAT } from './national/bo-fe';
import { BR_NFE_FORMAT } from './national/br-nfe';
import { CL_DTE_FORMAT } from './national/cl-dte';
import { CR_FE_FORMAT } from './national/cr-fe';
import { DO_ECF_FORMAT } from './national/do-ecf';
import { EC_FE_FORMAT } from './national/ec-fe';
import { GT_FEL_FORMAT } from './national/gt-fel';
import { PA_FE_FORMAT } from './national/pa-fe';
import { PY_DE_FORMAT } from './national/py-de';
import { SV_DTE_FORMAT } from './national/sv-dte';
import { UY_CFE_FORMAT } from './national/uy-cfe';
import { VE_FE_FORMAT } from './national/ve-fe';
import { JO_JOFOTARA_FORMAT } from './national/jo-jofotara';
import { TN_TEIF_FORMAT } from './national/tn-teif';
import { NG_FIRS_FORMAT } from './national/ng-firs';
import { KE_ETIMS_FORMAT } from './national/ke-etims';
import { GH_EVAT_FORMAT } from './national/gh-evat';
import { RW_EBM_FORMAT } from './national/rw-ebm';
import { TZ_VFD_FORMAT } from './national/tz-vfd';
import { UG_EFRIS_FORMAT } from './national/ug-efris';
import { ZM_SMARTINVOICE_FORMAT } from './national/zm-smartinvoice';
import { ZW_FDMS_FORMAT } from './national/zw-fdms';
import { CI_FNE_FORMAT } from './national/ci-fne';
import { BJ_MECEF_FORMAT } from './national/bj-mecef';
import { ID_EFAKTUR_FORMAT } from './national/id-efaktur';
import { TW_EGUI_FORMAT } from './national/tw-egui';
import { KZ_ESF_FORMAT } from './national/kz-esf';
import { PH_EIS_FORMAT } from './national/ph-eis';
import { TH_ETAX_FORMAT } from './national/th-etax';
import { NP_CBMS_FORMAT } from './national/np-cbms';
import { BD_NBR_FORMAT } from './national/bd-nbr';
import { PK_FBR_FORMAT } from './national/pk-fbr';
import { UA_TAXINVOICE_FORMAT } from './national/ua-taxinvoice';
import { ME_FISCAL_FORMAT } from './national/me-fiscal';
import { HR_ERACUN_FORMAT } from './national/hr-eracun';
import { AL_FISCALIZATION_FORMAT } from './national/al-fiscalization';
import { CN_EFAPIAO_FORMAT } from './national/cn-efapiao';
import { IN_IRP_FORMAT } from './national/in-irp';
import { VN_TT78_FORMAT } from './national/vn-tt78';
import { TR_EFATURA_FORMAT } from './national/tr-efatura';
import { EG_ETA_FORMAT } from './national/eg-eta';

export const NATIONAL_FORMAT_SPECS: NationalFormatSpec[] = [
  AR_FE_FORMAT,
  BO_FE_FORMAT,
  BR_NFE_FORMAT,
  CL_DTE_FORMAT,
  CR_FE_FORMAT,
  DO_ECF_FORMAT,
  EC_FE_FORMAT,
  GT_FEL_FORMAT,
  PA_FE_FORMAT,
  PY_DE_FORMAT,
  SV_DTE_FORMAT,
  UY_CFE_FORMAT,
  VE_FE_FORMAT,
  JO_JOFOTARA_FORMAT,
  TN_TEIF_FORMAT,
  NG_FIRS_FORMAT,
  KE_ETIMS_FORMAT,
  GH_EVAT_FORMAT,
  RW_EBM_FORMAT,
  TZ_VFD_FORMAT,
  UG_EFRIS_FORMAT,
  ZM_SMARTINVOICE_FORMAT,
  ZW_FDMS_FORMAT,
  CI_FNE_FORMAT,
  BJ_MECEF_FORMAT,
  ID_EFAKTUR_FORMAT,
  TW_EGUI_FORMAT,
  KZ_ESF_FORMAT,
  PH_EIS_FORMAT,
  TH_ETAX_FORMAT,
  NP_CBMS_FORMAT,
  BD_NBR_FORMAT,
  PK_FBR_FORMAT,
  UA_TAXINVOICE_FORMAT,
  ME_FISCAL_FORMAT,
  HR_ERACUN_FORMAT,
  AL_FISCALIZATION_FORMAT,
  CN_EFAPIAO_FORMAT,
  IN_IRP_FORMAT,
  VN_TT78_FORMAT,
  TR_EFATURA_FORMAT,
  EG_ETA_FORMAT,
];

export const NATIONAL_FORMAT_PROVIDERS: FormatProvider[] = NATIONAL_FORMAT_SPECS.map(nationalFormat);
