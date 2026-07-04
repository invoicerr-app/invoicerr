/**
 * FatturaPA 1.2 (IT/SM) builder.
 *
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';

/** FatturaPA 1.2 XML (IT/SM) via @digitalia/fatturapa — JSON→XML.
 *
 *  Key design decisions (reusable as format template):
 *  - ALL amounts/dates are **strings** matching the yup regex patterns
 *    (e.g. /^[-]?\d{1,12}(\.\d{2,8})$/ for PrezzoTotale, /^[-]?\d{1,3}(\.\d{2,2})$/ for AliquotaIVA).
 *  - Natura is deduced from operation nature (client country + VAT) — NOT a blanket N1 for 0%.
 *  - CodiceDestinatario defaults to 'XXXXXXX' (foreign/no-PEC) — PEC field absent from model = documented gap.
 *  - ProgressivoInvio is derived from invoice number or timestamp for uniqueness.
 *  - Contatti only emitted when data exists (never undefined).
 *  - RiferimentoNormativo emitted when Natura is present (legal reference).
 *  - EsigibilitaIVA defaults to 'I' (immédiate).
 */
export async function buildFatturaPa(data: InvoiceRenderData): Promise<string> {
        const { fpa2xml } = await import('@digitalia/fatturapa');

        // ── helpers ──────────────────────────────────────────────────────
        /** Format a number as a string matching the yup SPrezzoSchema regex: /^[-]?\d{1,12}(\.\d{2,8})$/ */
        const fmtAmount = (n: number, decimals = 2): string => {
            const factor = 10 ** decimals;
            const rounded = Math.round(n * factor) / factor;
            return rounded.toFixed(decimals);
        };
        /** Format AliquotaIVA as /^[-]?\d{1,3}(\.\d{2,2})$/ */
        const fmtRate = (n: number): string => n.toFixed(2);
        /** Map NaturaType — codes N1–N7 per FatturaPA spec */
        const mapNatura = (vatRate: number, clientCountry: string, clientVatId: string): string | undefined => {
            if (vatRate > 0) return undefined;
            const cc = (clientCountry || '').slice(0, 2).toUpperCase();
            // Intra-EU reverse charge: client in EU (not IT) with valid VAT ID
            const EU_CC = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];
            if (cc !== 'IT' && EU_CC.includes(cc) && clientVatId) return 'N6';
            // Default non soggette for domestic 0% rate
            return 'N2';
        };
        /** RiferimentoNormativo text per Natura code */
        const riferimentoNormativo = (natura: string): string => {
            switch (natura) {
                case 'N6': return 'Reverse charge art. 17 DPR 633/72';
                case 'N4': return 'Esente art. 10 DPR 633/72';
                case 'N3': return 'Non imponibile art. 8 DPR 633/72';
                case 'N2': return 'Operazione non soggetta';
                default: return 'Art. 1 DPR 633/72';
            }
        };

        // ── identifiers ──────────────────────────────────────────────────
        const vatId = getIdentifier(data.company, 'VAT') || '';
        const vatCountry = (data.company.country || 'IT').slice(0, 2).toUpperCase();
        const cf = getIdentifier(data.company, 'LEGAL_ID') || '';

        const clienteVatId = getIdentifier(data.client, 'VAT') || '';
        const clienteVatCountry = (data.client.country || '').slice(0, 2).toUpperCase();
        const clienteCf = getIdentifier(data.client, 'LEGAL_ID') || '';

        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];

        // ── ProgressivoInvio: unique per invoice ─────────────────────────
        const progressivoInvio = (data.rawNumber || data.number?.toString() || Date.now().toString())
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 10) || '00001';

        // ── CodiceDestinatario ──────────────────────────────────────────
        // FPR12 requires 7 chars. 'XXXXXXX' = foreign/unknown (no PEC).
        // '0000000' requires PECDestinatario (PEC email) — absent from model → documented gap.
        const codiceDestinatario = 'XXXXXXX';

        // ── DettaglioLinee ──────────────────────────────────────────────
        const dettaglioLinee = data.items.map((item, idx) => {
            const natura = mapNatura(item.vatRate || 0, clienteVatCountry, clienteVatId);
            return {
                NumeroLinea: idx + 1,
                Descrizione: item.name,
                Quantita: fmtAmount(item.quantity, 2),
                PrezzoUnitario: fmtAmount(item.unitPrice, 8),
                PrezzoTotale: fmtAmount(item.quantity * item.unitPrice, 8),
                AliquotaIVA: fmtRate(item.vatRate || 0),
                ...(natura ? { Natura: natura, RiferimentoNormativo: riferimentoNormativo(natura) } : {}),
            };
        });

        // ── DatiRiepilogo: grouped by VAT rate ──────────────────────────
        const datiRiepilogo = data.items.reduce<Record<string, { imponibile: number; imposta: number; rate: number; natura?: string }>>((acc, item) => {
            const rate = item.vatRate || 0;
            const key = String(rate);
            if (!acc[key]) {
                const natura = mapNatura(rate, clienteVatCountry, clienteVatId);
                acc[key] = { imponibile: 0, imposta: 0, rate, natura };
            }
            acc[key].imponibile += item.quantity * item.unitPrice;
            acc[key].imposta += item.quantity * item.unitPrice * rate / 100;
            return acc;
        }, {});

        const riepilogoList = Object.values(datiRiepilogo).map(g => ({
            AliquotaIVA: fmtRate(g.rate),
            ImponibileImporto: fmtAmount(g.imponibile, 2),
            Imposta: fmtAmount(g.imposta, 2),
            EsigibilitaIVA: 'I' as const,
            ...(g.natura ? { Natura: g.natura, RiferimentoNormativo: riferimentoNormativo(g.natura) } : {}),
        }));

        // ── Contatti: only emit if data present (never undefined) ────────
        const contatti: Record<string, string> = {};
        if (data.company.phone) contatti.Telefono = data.company.phone;
        if (data.company.email) contatti.Email = data.company.email;

        const totaleImponibile = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totaleIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);

        // ── Build the FatturaPA JSON object ──────────────────────────────
        const fattura = {
            'p:FatturaElettronica': {
                '@': {
                    versione: 'FPR12',
                    'xmlns:p': 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2',
                    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
                    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                    'xsi:schemaLocation': 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_VFPR12.xsd',
                },
                FatturaElettronicaHeader: {
                    DatiTrasmissione: {
                        IdTrasmittente: { IdPaese: vatCountry, IdCodice: cf || vatId },
                        ProgressivoInvio: progressivoInvio,
                        FormatoTrasmissione: 'FPR12',
                        CodiceDestinatario: codiceDestinatario,
                    },
                    CedentePrestatore: {
                        DatiAnagrafici: {
                            IdFiscaleIVA: { IdPaese: vatCountry, IdCodice: vatId },
                            Anagrafica: { Denominazione: data.company.name },
                            RegimeFiscale: 'RF01',
                        },
                        Sede: {
                            Indirizzo: data.company.address || 'N/A',
                            CAP: data.company.postalCode || '00000',
                            Comune: data.company.city || 'N/A',
                            Nazione: vatCountry,
                        },
                        ...(Object.keys(contatti).length > 0 ? { Contatti: contatti } : {}),
                    },
                    CessionarioCommittente: {
                        DatiAnagrafici: {
                            // XSD sequence: IdFiscaleIVA → CodiceFiscale → Anagrafica (order matters).
                            // CodiceFiscale must match [A-Z0-9]{11,16} (ITA XSD constraint); skip
                            // values like CCIAA registration numbers that are stored as LEGAL_ID.
                            ...(clienteVatId ? { IdFiscaleIVA: { IdPaese: clienteVatCountry, IdCodice: clienteVatId } } : {}),
                            ...(clienteCf && /^[A-Z0-9]{11,16}$/.test(clienteCf) ? { CodiceFiscale: clienteCf } : {}),
                            Anagrafica: { Denominazione: data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim() },
                        },
                        Sede: {
                            Indirizzo: data.client.address || 'N/A',
                            CAP: data.client.postalCode || '00000',
                            Comune: data.client.city || 'N/A',
                            Nazione: clienteVatCountry || 'IT',
                        },
                        // yup schema requires StabileOrganizzazione when Sede.Nazione !== 'IT'
                        ...(clienteVatCountry && clienteVatCountry !== 'IT' ? {
                            StabileOrganizzazione: {
                                Indirizzo: data.client.address || 'N/A',
                                CAP: data.client.postalCode || '00000',
                                Comune: data.client.city || 'N/A',
                                Nazione: clienteVatCountry,
                            },
                        } : {}),
                    },
                },
                'FatturaElettronicaBody': {
                    DatiGenerali: {
                        DatiGeneraliDocumento: {
                            TipoDocumento: 'TD01',
                            Divisa: data.company.currency || 'EUR',
                            Data: issueDate,
                            Numero: data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                            ImportoTotaleDocumento: fmtAmount(totaleImponibile + totaleIVA, 2),
                        },
                    },
                    DatiBeniServizi: {
                        DettaglioLinee: dettaglioLinee,
                        DatiRiepilogo: riepilogoList,
                    },
                    DatiPagamento: {
                        CondizioniPagamento: 'TP02',
                        DettaglioPagamento: {
                            ModalitaPagamento: 'MP05',
                            ImportoPagamento: fmtAmount(totaleImponibile + totaleIVA, 2),
                        },
                    },
                },
            },
        };

        return fpa2xml(fattura as any);
}
