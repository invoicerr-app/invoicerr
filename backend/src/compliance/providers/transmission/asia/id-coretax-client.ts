/**
 * Indonesia DGT Coretax / e-Faktur client — scaffold, live-deferred.
 *
 * Indonesia's Coretax system (launched January 2025) replaces the legacy offline
 * e-Faktur application (Faktur Pajak Elektronik, FP). All electronic tax invoices
 * (Faktur Pajak) must be submitted to the Direktorat Jenderal Pajak (DGT) via Coretax.
 *
 * Real integration requires:
 *   1. Enroll via DJP Online / NPWP registration.
 *   2. Obtain a Nomor Seri Faktur Pajak (NSFP) — the pre-assigned sequential invoice serial.
 *   3. Auth: POST /api/v1/auth/login with NPWP + passphrase → Bearer token (session).
 *   4. Submit Faktur Pajak: POST /api/v1/efaktur/submit
 *      Body: { fakturList: [ { nsfp, tanggalFaktur, npwpPenjual, npwpPembeli, ... } ] }
 *   5. Poll: GET /api/v1/efaktur/status/{nsfp} → { status: "APPROVED" | "REJECTED" | "PENDING" }
 *
 * The NSFP (Nomor Seri Faktur Pajak) is a 16-digit serial pre-assigned by DGT.
 * The approval code (Kode Otorisasi) is returned by Coretax after successful clearance.
 *
 * Endpoints (sandbox — "PJAP Developer Portal"):
 *   Base: https://efaktur-preprod.pajak.go.id
 * Endpoints (production):
 *   Base: https://efaktur.pajak.go.id
 *
 * Note: The DGT API is undergoing stabilization as of 2025 (Coretax launch had issues).
 * This scaffold uses endpoint shapes from early DGT documentation.
 * No public sandbox credentials available — live proof deferred.
 */

export type IdCoretaxEnvironment = 'preprod' | 'prod';

const CORETAX_BASE_URLS: Record<IdCoretaxEnvironment, string> = {
  preprod: 'https://efaktur-preprod.pajak.go.id',
  prod: 'https://efaktur.pajak.go.id',
};

// ---------------------------------------------------------------------------
// Types (aligned to DGT Coretax API documentation, early 2025)
// ---------------------------------------------------------------------------

export interface IdCoretaxAuthResponse {
  /** Bearer token (valid ~1h). */
  token: string;
  /** Token type (usually "Bearer"). */
  tokenType: string;
  /** Expires in seconds. */
  expiresIn: number;
  /** DGT session ID (for logging). */
  sessionId?: string;
}

export interface IdCoretaxFakturItem {
  /**
   * Nomor Seri Faktur Pajak (NSFP) — 16-digit serial pre-assigned by DGT.
   * Format: NNNNNN-YY.NNNNNNN (or compact 16 digits).
   * TODO: implement NSFP request flow (GET /api/v1/nsfp/request).
   */
  nsfp: string;
  /** Invoice date (YYYY-MM-DD). */
  tanggalFaktur: string;
  /** Seller NPWP (Nomor Pokok Wajib Pajak, 15 digits). */
  npwpPenjual: string;
  /** Buyer NPWP. Use '000000000000000' for B2C or non-PKP buyer. */
  npwpPembeli: string;
  /** Buyer name. */
  namaPembeli: string;
  /** Buyer address. */
  alamatPembeli: string;
  /** DPP (Dasar Pengenaan Pajak) — taxable base amount in IDR. */
  dpp: number;
  /** PPN (Pajak Pertambahan Nilai) — VAT amount in IDR (usually 11% of DPP). */
  ppn: number;
  /** PPN rate (11 for standard; 0 for exempt). */
  tarifPpn: number;
  /** Line items (Barang/Jasa). */
  barangJasas: Array<{
    /** Item code from the seller's system. */
    kodeBarang: string;
    /** Item/service description. */
    namaBarang: string;
    /** Unit of measure (e.g. "Unit", "Jam"). */
    satuan: string;
    /** Quantity. */
    jumlah: number;
    /** Unit price in IDR. */
    hargaSatuan: number;
    /** Total value (jumlah × hargaSatuan). */
    jumlahBarangJasa: number;
    /** Discount amount. */
    potonganHarga: number;
    /** DPP for this line. */
    dppBarang: number;
    /** PPN for this line. */
    ppnBarang: number;
  }>;
}

export interface IdCoretaxSubmissionRequest {
  fakturList: IdCoretaxFakturItem[];
}

export interface IdCoretaxSubmissionResponse {
  /** Overall result: "OK" or "ERROR". */
  result: 'OK' | 'ERROR';
  /** Per-invoice submission results. */
  fakturResults: Array<{
    nsfp: string;
    /** "APPROVED" — Coretax has accepted and assigned approval code. */
    status: 'APPROVED' | 'REJECTED' | 'PENDING';
    /** Kode Otorisasi (approval code) — issued by DGT on APPROVED. */
    kodeOtorisasi?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export interface IdCoretaxStatusResponse {
  nsfp: string;
  status: 'APPROVED' | 'REJECTED' | 'PENDING';
  kodeOtorisasi?: string;
  tanggalPersetujuan?: string; // approval datetime
  errorCode?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface IdCoretaxHttpPort {
  /** Authenticate with Coretax API — returns bearer token. */
  authenticate(baseUrl: string, npwp: string, passphrase: string): Promise<IdCoretaxAuthResponse>;
  /** Submit Faktur Pajak (one or more) for clearance. */
  submitFaktur(baseUrl: string, token: string, req: IdCoretaxSubmissionRequest): Promise<IdCoretaxSubmissionResponse>;
  /** Poll clearance status for a given NSFP. */
  getStatus(baseUrl: string, token: string, nsfp: string): Promise<IdCoretaxStatusResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface IdCoretaxClientConfig {
  environment: IdCoretaxEnvironment;
  /** NPWP of the company (15 digits). */
  npwp: string;
  /**
   * Passphrase / API password for Coretax authentication.
   * TODO: wire to SigningCredentialsPort for encrypted storage.
   */
  passphrase?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Client for Indonesia DGT Coretax e-Faktur API.
 *
 * SCAFFOLD — mocked HTTP port used in tests; real network calls deferred.
 * Missing for real integration:
 *   - NSFP request flow (GET /nsfp/request → receive batch of serials)
 *   - PPnBM (luxury goods tax) support
 *   - e-Faktur correction (Penggantian / Pembatalan flows)
 *   - Coretax e-Bupot (withholding evidence) submission
 *   - Real VAT rate calculation (standard 11%, 0% for export, PPN PMSE, etc.)
 */
export class IdCoretaxClient {
  private readonly baseUrl: string;
  private cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly http: IdCoretaxHttpPort,
    private readonly config: IdCoretaxClientConfig,
  ) {
    this.baseUrl = CORETAX_BASE_URLS[config.environment];
  }

  /** Authenticate with Coretax and return/cache a bearer token. */
  async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }
    const passphrase = this.config.passphrase ?? '<!-- TODO: Coretax passphrase -->';
    const resp = await this.http.authenticate(this.baseUrl, this.config.npwp, passphrase);
    this.cachedToken = {
      token: resp.token,
      expiresAt: now + (resp.expiresIn - 60) * 1000,
    };
    return resp.token;
  }

  /**
   * Submit one or more Faktur Pajak for clearance.
   *
   * LIVE PROOF: DEFERRED — real NPWP + passphrase + pre-assigned NSFP required.
   */
  async submitFaktur(items: IdCoretaxFakturItem[]): Promise<IdCoretaxSubmissionResponse> {
    const token = await this.authenticate();
    return this.http.submitFaktur(this.baseUrl, token, { fakturList: items });
  }

  /**
   * Poll the clearance status for a given NSFP.
   * Returns "APPROVED" with kodeOtorisasi on success.
   */
  async getStatus(nsfp: string): Promise<IdCoretaxStatusResponse> {
    const token = await this.authenticate();
    return this.http.getStatus(this.baseUrl, token, nsfp);
  }
}
