import { CountryComplianceProfile } from '../schema';
import { AE } from './ae';
import { AL } from './al';
import { AO } from './ao';
import { AR } from './ar';
import { AT } from './at';
import { AU } from './au';
import { BA } from './ba';
import { BD } from './bd';
import { BE } from './be';
import { BG } from './bg';
import { BH } from './bh';
import { BJ } from './bj';
import { BO } from './bo';
import { BR } from './br';
import { CA } from './ca';
import { CH } from './ch';
import { CI } from './ci';
import { CL } from './cl';
import { CM } from './cm';
import { CN } from './cn';
import { CO } from './co';
import { CR } from './cr';
import { CY } from './cy';
import { CZ } from './cz';
import { DE } from './de';
import { DK } from './dk';
import { DO } from './do';
import { DZ } from './dz';
import { EC } from './ec';
import { EE } from './ee';
import { EG } from './eg';
import { ES } from './es';
import { ET } from './et';
import { FI } from './fi';
import { FR } from './fr';
import { GB } from './gb';
import { GH } from './gh';
import { GR } from './gr';
import { GT } from './gt';
import { HN } from './hn';
import { HR } from './hr';
import { HU } from './hu';
import { ID } from './id';
import { IE } from './ie';
import { IN } from './in';
import { IT } from './it';
import { JO } from './jo';
import { JP } from './jp';
import { KE } from './ke';
import { KW } from './kw';
import { KZ } from './kz';
import { LI } from './li';
import { LK } from './lk';
import { LT } from './lt';
import { LU } from './lu';
import { LV } from './lv';
import { MA } from './ma';
import { MC } from './mc';
import { MD } from './md';
import { ME } from './me';
import { MK } from './mk';
import { MT } from './mt';
import { MX } from './mx';
import { MY } from './my';
import { MZ } from './mz';
import { NG } from './ng';
import { NI } from './ni';
import { NL } from './nl';
import { NO } from './no';
import { NP } from './np';
import { NZ } from './nz';
import { OM } from './om';
import { PA } from './pa';
import { PE } from './pe';
import { PH } from './ph';
import { PK } from './pk';
import { PL } from './pl';
import { PT } from './pt';
import { PY } from './py';
import { QA } from './qa';
import { RO } from './ro';
import { RS } from './rs';
import { RW } from './rw';
import { SA } from './sa';
import { SE } from './se';
import { SG } from './sg';
import { SI } from './si';
import { SK } from './sk';
import { SM } from './sm';
import { SN } from './sn';
import { SV } from './sv';
import { TH } from './th';
import { TN } from './tn';
import { TR } from './tr';
import { TW } from './tw';
import { TZ } from './tz';
import { UA } from './ua';
import { UG } from './ug';
import { US } from './us';
import { UY } from './uy';
import { VA } from './va';
import { VE } from './ve';
import { VN } from './vn';
import { ZA } from './za';
import { ZM } from './zm';
import { ZW } from './zw';

/**
 * Hand-written profiles with richer, verified specifics (OFFICIAL confidence).
 * Every other country is archetype-built and lives in its own file next to these.
 */
export const BESPOKE_PROFILES: CountryComplianceProfile[] = [DE, ES, FR, US, MX, IT, PL, MC];

/**
 * Every wired jurisdiction — one file per country, no regional bundles. Adding a country
 * means adding `data/xx.ts` plus its import and list entry here.
 */
export const ALL_PROFILES: CountryComplianceProfile[] = [
  AE,
  AL,
  AO,
  AR,
  AT,
  AU,
  BA,
  BD,
  BE,
  BG,
  BH,
  BJ,
  BO,
  BR,
  CA,
  CH,
  CI,
  CL,
  CM,
  CN,
  CO,
  CR,
  CY,
  CZ,
  DK,
  DO,
  DZ,
  EC,
  EE,
  EG,
  ET,
  FI,
  GB,
  GH,
  GR,
  GT,
  HN,
  HR,
  HU,
  ID,
  IE,
  IN,
  JO,
  JP,
  KE,
  KW,
  KZ,
  LI,
  LK,
  LT,
  LU,
  LV,
  MA,
  MD,
  ME,
  MK,
  MT,
  MY,
  MZ,
  NG,
  NI,
  NL,
  NO,
  NP,
  NZ,
  OM,
  PA,
  PE,
  PH,
  PK,
  PT,
  PY,
  QA,
  RO,
  RS,
  RW,
  SA,
  SE,
  SG,
  SI,
  SK,
  SM,
  SN,
  SV,
  TH,
  TN,
  TR,
  TW,
  TZ,
  UA,
  UG,
  UY,
  VA,
  VE,
  VN,
  ZA,
  ZM,
  ZW,
  ...BESPOKE_PROFILES,
];
