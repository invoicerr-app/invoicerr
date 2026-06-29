/**
 * Kenya KRA eTIMS (Electronic Tax Invoice Management System) client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   1. Register as a KRA-approved vendor and obtain an OSCU (Online Sales Control Unit)
 *      or VSCU (Virtual Sales Control Unit) device serial number.
 *   2. Initialize the OSCU/VSCU via POST /initializer → receive deviceSerial + key.
 *   3. Auth: POST /auth/authToken with taxpayerPin + deviceSerial → Bearer token.
 *   4. Send invoice: POST /trnsSales/saveTrns with the eTIMS invoice payload.
 *      KRA eTIMS returns: rcptNo (receipt number), intrlData (internal data), rcptSign (signature),
 *      sdcDateTime, sdcId, totRcptNo (total receipt count).
 *   5. QR code: encode {pin}|{rcptNo}|{intrlData}|{rcptSign} as a QR code for the receipt.
 *   6. Poll: GET /trnsSales/selectTrns?invoiceNo={invoiceNo} for status.
 *
 * Endpoints (eTIMS VSCU API — Kenya sandbox):
 *   Base: https://etims-api-sbx.kra.go.ke/etims-api
 *
 * No public sandbox credentials — live proof deferred.
 */

export type KeKraEnvironment = 'sandbox' | 'prod';

const KRA_BASE_URLS: Record<KeKraEnvironment, string> = {
  sandbox: 'https://etims-api-sbx.kra.go.ke/etims-api',
  prod: 'https://etims-api.kra.go.ke/etims-api',
};

// ---------------------------------------------------------------------------
// Types (aligned to KRA eTIMS VSCU API v1.0)
// ---------------------------------------------------------------------------

export interface KeKraAuthRequest {
  /** Taxpayer PIN (KRA Personal Identification Number, 11 chars). */
  taxpayerPin: string;
  /** OSCU/VSCU device serial number (from KRA device registration). */
  deviceSerial: string;
}

export interface KeKraAuthResponse {
  /** Bearer token for subsequent calls. */
  resultCd: string;
  resultMsg: string;
  data?: {
    /** Signed token for this device session. */
    authToken: string;
    /** Device initialization state (0=initialized, 1=not). */
    cisAplctnDt?: string;
  };
}

export interface KeKraTaxItem {
  /** Item sequence number. */
  itemSeq: number;
  /** Item name/description. */
  itemNm: string;
  /** Item classification code (eTIMS category code, e.g. "20101601"). */
  itemClsCd: string;
  /** Item type code (1=goods, 2=service). */
  itemTyCd: string;
  /** Unit of quantity (e.g. "U" for units). */
  qty: number;
  prc: number;
  /** Supply amount (qty × prc). */
  splyAmt: number;
  /** Discount amount. */
  dcAmt: number;
  /** Taxable amount. */
  taxblAmt: number;
  /** Tax rate type (A=16% VAT, B=8% VAT, C=0% VAT, D=excise, E=exempt). */
  taxTyCd: 'A' | 'B' | 'C' | 'D' | 'E';
  /** Tax amount. */
  taxAmt: number;
  /** Total amount (taxblAmt + taxAmt). */
  totAmt: number;
}

export interface KeKraInvoicePayload {
  /** Taxpayer PIN. */
  tpin: string;
  /** Branch ID (use "00" for single-branch; multi-branch: assigned by KRA). */
  bhfId: string;
  /** Invoice number (unique per taxpayer). */
  invoiceNo: string;
  /** ISO 8601 date: YYYYMMDD. */
  invoiceDate: string;
  /** Buyer PIN (or "NON" for non-registered buyers). */
  custPin?: string;
  /** Buyer name. */
  custNm: string;
  /** Invoice type code (1=credit, 2=debit, 3=copy). */
  invTypCd: string;
  /** Payment type code (01=cash, 02=credit, 03=bank transfer). */
  pymtTyCd: string;
  /** Validation date (YYYYMMDD). */
  validDt: string;
  items: KeKraTaxItem[];
  /** Totals. */
  totItemCnt: number;
  taxblAmtA: number;  // Taxable amount at 16% (VAT type A)
  taxblAmtB: number;  // Taxable amount at 8% (VAT type B)
  taxblAmtC: number;  // Taxable amount at 0% (VAT type C)
  taxblAmtD: number;  // Taxable amount excise
  taxblAmtE: number;  // Exempt amount
  taxAmtA: number;    // VAT at 16%
  taxAmtB: number;    // VAT at 8%
  taxAmtC: number;
  taxAmtD: number;
  taxAmtE: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
}

export interface KeKraInvoiceResponse {
  resultCd: string;
  resultMsg: string;
  data?: {
    /** Receipt number (sequential, assigned by KRA eTIMS). */
    rcptNo: number;
    /** Internal verification data (base64). */
    intrlData: string;
    /** Receipt signature (base64, for QR code). */
    rcptSign: string;
    /** SDC (Sales Data Controller) device datetime. */
    sdcDateTime: string;
    /** Total receipt count for this device. */
    totRcptNo: number;
  };
}

export interface KeKraStatusResponse {
  resultCd: string;
  resultMsg: string;
  data?: {
    invoiceNo: string;
    rcptNo?: number;
    status?: string;
  };
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface KeKraHttpPort {
  /** Authenticate OSCU/VSCU device with KRA eTIMS. */
  authenticate(baseUrl: string, req: KeKraAuthRequest): Promise<KeKraAuthResponse>;
  /** Save (submit) a sales transaction to KRA eTIMS. */
  saveTrns(baseUrl: string, token: string, payload: KeKraInvoicePayload): Promise<KeKraInvoiceResponse>;
  /** Query a transaction by invoiceNo. */
  selectTrns(baseUrl: string, token: string, invoiceNo: string): Promise<KeKraStatusResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface KeKraClientConfig {
  environment: KeKraEnvironment;
  /** KRA taxpayer PIN (11 chars, e.g. "A000000000A"). */
  taxpayerPin: string;
  /** OSCU/VSCU device serial number. */
  deviceSerial?: string;
  /** Branch ID (default "00"). */
  branchId?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * KRA eTIMS (Kenya) e-invoice client.
 *
 * SCAFFOLD — mocked HTTP port used in tests; real network calls deferred.
 * Missing for real integration:
 *   - OSCU/VSCU device initialization (POST /initializer)
 *   - Item classification code (eTIMS GS1 category code per item)
 *   - Supply amount discount handling
 *   - QR code generation: encode {pin}|{rcptNo}|{intrlData}|{rcptSign}
 *   - Branch ID assignment for multi-branch taxpayers
 *   - Fiscal receipt printing requirements (thermal printer integration)
 *   - Credit note flow (invTypCd = "2" for debit/credit notes)
 *
 * LIVE PROOF: DEFERRED — KRA taxpayerPin + deviceSerial required.
 */
export class KeKraClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: KeKraHttpPort,
    private readonly config: KeKraClientConfig,
  ) {
    this.baseUrl = KRA_BASE_URLS[config.environment];
  }

  /** Authenticate the OSCU/VSCU device with KRA eTIMS. */
  async authenticate(): Promise<KeKraAuthResponse> {
    return this.http.authenticate(this.baseUrl, {
      taxpayerPin: this.config.taxpayerPin,
      deviceSerial: this.config.deviceSerial ?? 'TODO-DEVICE-SERIAL',
    });
  }

  /**
   * Submit a sales transaction to KRA eTIMS.
   * Returns rcptNo + rcptSign for QR code embedding.
   *
   * LIVE PROOF: DEFERRED — device credentials required.
   */
  async saveTrns(token: string, payload: KeKraInvoicePayload): Promise<KeKraInvoiceResponse> {
    return this.http.saveTrns(this.baseUrl, token, payload);
  }

  /** Query a transaction status by invoice number. */
  async selectTrns(token: string, invoiceNo: string): Promise<KeKraStatusResponse> {
    return this.http.selectTrns(this.baseUrl, token, invoiceNo);
  }

  /** Full flow: authenticate → saveTrns. Returns receipt data. */
  async submitInvoice(payload: KeKraInvoicePayload): Promise<KeKraInvoiceResponse> {
    const auth = await this.authenticate();
    if (!auth.data?.authToken) {
      throw new Error(`KRA eTIMS auth failed: ${auth.resultMsg} (code: ${auth.resultCd})`);
    }
    return this.saveTrns(auth.data.authToken, payload);
  }

  /**
   * Build the QR code string for a receipt.
   * Format: {pin}|{rcptNo}|{intrlData}|{rcptSign}
   *
   * SCAFFOLD: the actual QR code must be encoded as a QR image and printed on the receipt.
   */
  static buildQrString(pin: string, rcptNo: number, intrlData: string, rcptSign: string): string {
    return `${pin}|${rcptNo}|${intrlData}|${rcptSign}`;
  }
}
