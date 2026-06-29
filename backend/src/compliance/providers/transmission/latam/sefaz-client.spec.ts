/**
 * SEFAZ NF-e client — mocked HTTP tests.
 * All SOAP calls go through the injectable SefazHttpPort — no real network.
 * Live integration proof deferred (ICP-Brasil certificate required).
 */
import { SefazClient, SefazClientConfig, SefazHttpPort } from './sefaz-client';

const TEST_CONFIG: SefazClientConfig = {
  environment: 'hom',
  cnpj: '12345678000190',
};

function mockHttp(overrides?: Partial<SefazHttpPort>): SefazHttpPort {
  return {
    autorizarLote: jest.fn().mockResolvedValue({ nRec: '135123456789012', cStat: 103, xMotivo: 'Lote Recebido' }),
    retornoLote: jest.fn().mockResolvedValue({
      cStat: 104,
      xMotivo: 'Lote Processado',
      protNFe: {
        chNFe: '35250612345678000190550010000000011000000010',
        nProt: '135000000000001',
        cStat: 100,
        xMotivo: 'Autorizado o uso da NF-e',
        dhRecbto: '2026-06-29T12:00:00-03:00',
      },
    }),
    consultaSituacao: jest.fn().mockResolvedValue({
      cStat: 100,
      xMotivo: 'Autorizado o uso da NF-e',
      protNFe: {
        chNFe: '35250612345678000190550010000000011000000010',
        nProt: '135000000000001',
        cStat: 100,
        xMotivo: 'Autorizado o uso da NF-e',
        dhRecbto: '2026-06-29T12:00:00-03:00',
      },
    }),
    ...overrides,
  };
}

const NFE_XML = Buffer.from('<?xml version="1.0"?><NFe><infNFe versao="4.00"/></NFe>', 'utf8');

describe('SefazClient (mocked HTTP — live-deferred)', () => {
  it('submitLote() calls autorizacao endpoint and returns nRec', async () => {
    const http = mockHttp();
    const client = new SefazClient(http, TEST_CONFIG);
    const resp = await client.submitLote(NFE_XML);
    expect(http.autorizarLote).toHaveBeenCalledWith(
      expect.stringContaining('hom.nfe.fazenda.gov.br'),
      NFE_XML,
      expect.any(String), // cert
      expect.any(String), // pass
    );
    expect(resp.nRec).toBe('135123456789012');
    expect(resp.cStat).toBe(103); // Lote Recebido
  });

  it('pollLote() calls retAutorizacao with the nRec and CNPJ', async () => {
    const http = mockHttp();
    const client = new SefazClient(http, TEST_CONFIG);
    const resp = await client.pollLote('135123456789012');
    expect(http.retornoLote).toHaveBeenCalledWith(
      expect.stringContaining('NFeRetAutorizacao4'),
      '135123456789012',
      '12345678000190',
      expect.any(String),
      expect.any(String),
    );
    expect(resp.protNFe?.nProt).toBe('135000000000001');
    expect(resp.protNFe?.cStat).toBe(100); // Autorizado
  });

  it('consultaSituacao() queries by chNFe', async () => {
    const http = mockHttp();
    const client = new SefazClient(http, TEST_CONFIG);
    const chNFe = '35250612345678000190550010000000011000000010';
    const resp = await client.consultaSituacao(chNFe);
    expect(http.consultaSituacao).toHaveBeenCalledWith(
      expect.stringContaining('ConsultaProtocolo'),
      chNFe,
      expect.any(String),
      expect.any(String),
    );
    expect(resp.cStat).toBe(100);
  });

  it('uses prod URLs when environment is prod', async () => {
    const http = mockHttp();
    const client = new SefazClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.submitLote(NFE_XML);
    expect(http.autorizarLote).toHaveBeenCalledWith(
      expect.stringContaining('nfe.fazenda.gov.br'), // prod (no "hom.")
      NFE_XML,
      expect.any(String),
      expect.any(String),
    );
  });

  it('mapCStat correctly classifies SEFAZ status codes', () => {
    expect(SefazClient.mapCStat(100)).toBe('AUTHORIZED');
    expect(SefazClient.mapCStat(101)).toBe('CANCELLED');
    expect(SefazClient.mapCStat(110)).toBe('REJECTED');
    expect(SefazClient.mapCStat(103)).toBe('PENDING');
    expect(SefazClient.mapCStat(999)).toBe('REJECTED');
    expect(SefazClient.mapCStat(999)).toBe('REJECTED');
    expect(SefazClient.mapCStat(0)).toBe('PENDING'); // unknown → pending
  });

  it('propagates SEFAZ rejection (cStat 110)', async () => {
    const http = mockHttp({
      retornoLote: jest.fn().mockResolvedValue({
        cStat: 110,
        xMotivo: 'Uso Denegado',
        protNFe: { chNFe: 'xxx', cStat: 110, xMotivo: 'Rejeição: campo inválido' },
      }),
    });
    const client = new SefazClient(http, TEST_CONFIG);
    const resp = await client.pollLote('135000000000001');
    expect(SefazClient.mapCStat(resp.cStat)).toBe('REJECTED');
  });
});
