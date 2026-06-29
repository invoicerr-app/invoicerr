/**
 * Brazil SEFAZ NF-e client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   - ICP-Brasil digital certificate (A1/A3 PKCS#12) issued by accredited CA.
 *   - SOAP/HTTPS mutual TLS with the state SEFAZ web service.
 *   - NF-e XML signed with XmlDSig (XMLDSig alg RSA-SHA1 or RSA-SHA256).
 *   - lotEnvioNFe (batch) or individual submission, await retLoteNFe.
 *   - Status check: NfeConsultaProtocolo or NfeConsultaSituacao.
 *
 * Endpoints (test — SEFAZ Nacional):
 *   Autorizacao: https://hom.nfe.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx
 *   Retorno:     https://hom.nfe.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx
 *   Consulta:    https://hom.nfe.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx
 *
 * Note: each state (SP, RJ, MG…) has its own SEFAZ endpoint.
 * The SEFAZ Nacional / SVRS handles states that use the centralized service.
 *
 * LIVE PROOF: DEFERRED — ICP-Brasil certificate required.
 */

export type SefazEnvironment = 'hom' | 'prod';

const SEFAZ_URLS: Record<SefazEnvironment, {
  autorizacao: string;
  retAutorizacao: string;
  consultaProtocolo: string;
}> = {
  hom: {
    autorizacao: 'https://hom.nfe.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
    retAutorizacao: 'https://hom.nfe.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    consultaProtocolo: 'https://hom.nfe.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  },
  prod: {
    autorizacao: 'https://nfe.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
    retAutorizacao: 'https://nfe.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    consultaProtocolo: 'https://nfe.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SefazLoteResponse {
  /** Lote receipt number — used to poll for the authorization result. */
  nRec: string;
  /** SEFAZ status code: 103=lote received, 104=lote processed, 108=lote in queue */
  cStat: number;
  xMotivo: string;
}

export interface SefazProtocolo {
  /** NF-e access key (chNFe) — 44 alphanumeric chars. */
  chNFe: string;
  /** Authorization protocol number (nProt) */
  nProt?: string;
  cStat: number;
  xMotivo: string;
  /** Authorization date/time */
  dhRecbto?: string;
}

export interface SefazConsultaResponse {
  cStat: number;
  xMotivo: string;
  protNFe?: SefazProtocolo;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing (SOAP/HTTPS mutual TLS)
// ---------------------------------------------------------------------------

export interface SefazHttpPort {
  /**
   * POST a lotEnvioNFe SOAP envelope (mTLS with ICP-Brasil cert).
   * Returns nRec (lote receipt number) for async polling.
   */
  autorizarLote(
    url: string,
    nfeXmlSigned: Buffer,
    certBase64: string,
    certPassword: string,
  ): Promise<SefazLoteResponse>;

  /**
   * POST a consNRec SOAP envelope to check lote status.
   * Returns the autorização or rejection for each NF-e in the lote.
   */
  retornoLote(
    url: string,
    nRec: string,
    cnpj: string,
    certBase64: string,
    certPassword: string,
  ): Promise<SefazConsultaResponse>;

  /**
   * POST a consSitNFe SOAP envelope to check an individual NF-e status by chNFe.
   */
  consultaSituacao(
    url: string,
    chNFe: string,
    certBase64: string,
    certPassword: string,
  ): Promise<SefazConsultaResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface SefazClientConfig {
  environment: SefazEnvironment;
  /** CNPJ of the issuing company, digits only (14 chars). */
  cnpj: string;
  /** UF (state) — used to select the correct SEFAZ endpoint. For now uses SEFAZ Nacional. */
  uf?: string;
  /** ICP-Brasil certificate PKCS#12 (base64). Required for real integration. */
  certBase64?: string;
  certPassword?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SefazClient {
  private readonly urls: typeof SEFAZ_URLS[SefazEnvironment];

  constructor(
    private readonly http: SefazHttpPort,
    private readonly config: SefazClientConfig,
  ) {
    this.urls = SEFAZ_URLS[config.environment];
  }

  /**
   * Submit an NF-e lote (batch of 1 NF-e) to SEFAZ.
   * Returns the nRec for async status polling.
   *
   * LIVE PROOF: DEFERRED — ICP-Brasil cert required.
   */
  async submitLote(nfeXmlSigned: Buffer): Promise<SefazLoteResponse> {
    const cert = this.config.certBase64 ?? '';
    const pass = this.config.certPassword ?? '';
    return this.http.autorizarLote(this.urls.autorizacao, nfeXmlSigned, cert, pass);
  }

  /**
   * Poll for lote authorization result.
   */
  async pollLote(nRec: string): Promise<SefazConsultaResponse> {
    const cert = this.config.certBase64 ?? '';
    const pass = this.config.certPassword ?? '';
    return this.http.retornoLote(this.urls.retAutorizacao, nRec, this.config.cnpj, cert, pass);
  }

  /**
   * Direct situação query by chNFe (44-char access key).
   */
  async consultaSituacao(chNFe: string): Promise<SefazConsultaResponse> {
    const cert = this.config.certBase64 ?? '';
    const pass = this.config.certPassword ?? '';
    return this.http.consultaSituacao(this.urls.consultaProtocolo, chNFe, cert, pass);
  }

  /**
   * Map SEFAZ cStat code to human-readable status category.
   * Codes reference: Nota Técnica 2011.004, Tabela de cStat (Situação da NF-e).
   */
  static mapCStat(cStat: number): 'AUTHORIZED' | 'REJECTED' | 'CANCELLED' | 'PENDING' {
    if (cStat === 100) return 'AUTHORIZED';
    if (cStat === 101) return 'CANCELLED';
    if ([110, 301, 302, 303, 999].includes(cStat)) return 'REJECTED';
    if ([103, 104, 105, 106, 107, 108].includes(cStat)) return 'PENDING';
    return 'PENDING'; // unknown → pending
  }
}
