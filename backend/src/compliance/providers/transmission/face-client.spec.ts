/**
 * FaceClient tests — fully offline/mocked (no real SOAP calls).
 *
 * The response fixtures below are taken verbatim (structure + field names) from the Diputación
 * Foral de Gipuzkoa "Servicios para sistemas Automatizados de proveedores para su integración con
 * el P.G.E.F.e" v1.0.3 manual (§3.2.2 enviarFactura response example, §3.3.2 consultarFactura
 * response example) — a regional entry point that implements the same FACe SSPP WSDL contract
 * (confirmed by the shared `https://webservice.face.gob.es` namespace and operation names), only
 * wrapped in a full soap:Envelope since the manual shows the soap:Body fragment in isolation.
 */
import {
  FACE_ANULACION_ESTADOS,
  FACE_TRAMITACION_ESTADOS,
  FaceClient,
  FaceHttpPort,
  mapFaceEstado,
} from './face-client';

function envelope(bodyInner: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soapenv:Header/>' +
    `<soapenv:Body>${bodyInner}</soapenv:Body>` +
    '</soapenv:Envelope>'
  );
}

const ENVIAR_FACTURA_RESPONSE_XML = envelope(
  '<enviarFacturaResponse xmlns="https://webservice.face.gob.es">' +
    '<return>' +
    '<resultado><codigo>0</codigo><descripcion>Correcto</descripcion><codigoSeguimiento/></resultado>' +
    '<factura>' +
    '<numeroRegistro>2016/000001396</numeroRegistro>' +
    '<organoGestor>L00000001</organoGestor>' +
    '<unidadTramitadora>L00000001</unidadTramitadora>' +
    '<oficinaContable>L00000001</oficinaContable>' +
    '<identificadorEmisor>B12345678</identificadorEmisor>' +
    '<numeroFactura>X</numeroFactura>' +
    '<serieFactura/>' +
    '<fechaRecepcion>26/04/2016</fechaRecepcion>' +
    '</factura>' +
    '</return>' +
    '</enviarFacturaResponse>',
);

const CONSULTAR_FACTURA_RESPONSE_XML = envelope(
  '<consultarFacturaResponse xmlns="https://webservice.face.gob.es">' +
    '<return>' +
    '<resultado><codigo>0</codigo><descripcion/><codigoSeguimiento/></resultado>' +
    '<factura>' +
    '<numeroRegistro>2016/000000001</numeroRegistro>' +
    '<tramitacion><codigo>1200</codigo><descripcion>Registrada</descripcion><motivo/></tramitacion>' +
    '<anulacion><codigo>4100</codigo><descripcion>No solicita anulación</descripcion><motivo/></anulacion>' +
    '</factura>' +
    '</return>' +
    '</consultarFacturaResponse>',
);

/** Same consultarFacturaResponse but with an ns1: prefix (as shown by the Bizkaia PGEFe WSDL
 * example) instead of a default xmlns — proves the parser is namespace-prefix agnostic. */
const CONSULTAR_FACTURA_RESPONSE_NS1_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<soap:Body>' +
  '<ns1:consultarFacturaResponse xmlns:ns1="https://webservice.face.gob.es">' +
  '<return>' +
  '<resultado><codigo>0</codigo><descripcion/><codigoSeguimiento/></resultado>' +
  '<factura>' +
  '<numeroRegistro>2026/000000042</numeroRegistro>' +
  '<tramitacion><codigo>2600</codigo><descripcion>Rechazada</descripcion><motivo>Factura duplicada</motivo></tramitacion>' +
  '<anulacion><codigo>4100</codigo><descripcion>No solicita anulación</descripcion><motivo/></anulacion>' +
  '</factura>' +
  '</return>' +
  '</ns1:consultarFacturaResponse>' +
  '</soap:Body>' +
  '</soap:Envelope>';

const SOAP_FAULT_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<soapenv:Body><soapenv:Fault><faultcode>soapenv:Server</faultcode>' +
  '<faultstring>La firma de la petición SOAP no es válida</faultstring></soapenv:Fault></soapenv:Body>' +
  '</soapenv:Envelope>';

function mockHttp(response: { status: number; data: string }): FaceHttpPort & { post: jest.Mock } {
  return { post: jest.fn().mockResolvedValue(response) };
}

describe('FaceClient.enviarFactura', () => {
  it('builds the SOAP body with correo/factura/nombre/mime in the verified SSPP shape', async () => {
    const http = mockHttp({ status: 200, data: ENVIAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'https://se-face-webservice.redsara.es/facturasspp2' }, http);

    await client.enviarFactura({
      correo: 'facturacion@empresa.es',
      facturaBase64: 'QUJD',
      facturaNombre: 'invoice-42.xml',
    });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [endpoint, operation, body] = http.post.mock.calls[0];
    expect(endpoint).toBe('https://se-face-webservice.redsara.es/facturasspp2');
    expect(operation).toBe('enviarFactura');
    expect(body).toContain('<web:enviarFactura xmlns:web="https://webservice.face.gob.es">');
    expect(body).toContain('<correo>facturacion@empresa.es</correo>');
    expect(body).toContain('<factura><factura>QUJD</factura>');
    expect(body).toContain('<nombre>invoice-42.xml</nombre>');
    expect(body).toContain('<mime>application/xml</mime>');
    expect(body).toContain('<anexos></anexos>');
  });

  it('escapes XML-significant characters in correo/nombre', async () => {
    const http = mockHttp({ status: 200, data: ENVIAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await client.enviarFactura({
      correo: 'a&b<c>@empresa.es',
      facturaBase64: 'QUJD',
      facturaNombre: 'inv "1" & 2.xml',
    });
    const body = http.post.mock.calls[0][2] as string;
    expect(body).toContain('a&amp;b&lt;c&gt;@empresa.es');
    expect(body).toContain('inv &quot;1&quot; &amp; 2.xml');
  });

  it('includes anexos when provided', async () => {
    const http = mockHttp({ status: 200, data: ENVIAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await client.enviarFactura({
      correo: 'a@b.es',
      facturaBase64: 'QUJD',
      facturaNombre: 'inv.xml',
      anexos: [{ contenidoBase64: 'WFla', nombre: 'anexo1.pdf', mime: 'application/pdf' }],
    });
    const body = http.post.mock.calls[0][2] as string;
    expect(body).toContain(
      '<anexo><anexo>WFla</anexo><nombre>anexo1.pdf</nombre><mime>application/pdf</mime></anexo>',
    );
  });

  it('parses a successful response into numeroRegistro + resultado fields', async () => {
    const http = mockHttp({ status: 200, data: ENVIAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    const result = await client.enviarFactura({
      correo: 'a@b.es',
      facturaBase64: 'QUJD',
      facturaNombre: 'inv.xml',
    });
    expect(result.codigo).toBe('0');
    expect(result.descripcion).toBe('Correcto');
    expect(result.numeroRegistro).toBe('2016/000001396');
    expect(result.organoGestor).toBe('L00000001');
    expect(result.unidadTramitadora).toBe('L00000001');
    expect(result.oficinaContable).toBe('L00000001');
    expect(result.fechaRecepcion).toBe('26/04/2016');
  });

  it('throws when the HTTP transport reports an error status', async () => {
    const http = mockHttp({ status: 500, data: '' });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await expect(
      client.enviarFactura({ correo: 'a@b.es', facturaBase64: 'QUJD', facturaNombre: 'inv.xml' }),
    ).rejects.toThrow(/enviarFactura failed \(HTTP 500\)/);
  });

  it('throws a descriptive error on a SOAP Fault (e.g. invalid WS-Security signature)', async () => {
    const http = mockHttp({ status: 200, data: SOAP_FAULT_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await expect(
      client.enviarFactura({ correo: 'a@b.es', facturaBase64: 'QUJD', facturaNombre: 'inv.xml' }),
    ).rejects.toThrow(/La firma de la petición SOAP no es válida/);
  });
});

describe('FaceClient.consultarFactura', () => {
  it('builds the SOAP body with numeroRegistro in the verified SSPP shape', async () => {
    const http = mockHttp({ status: 200, data: CONSULTAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'https://webservice.face.gob.es/facturasspp2' }, http);
    await client.consultarFactura('2016/000000001');
    expect(http.post).toHaveBeenCalledWith(
      'https://webservice.face.gob.es/facturasspp2',
      'consultarFactura',
      '<web:consultarFactura xmlns:web="https://webservice.face.gob.es"><numeroRegistro>2016/000000001</numeroRegistro></web:consultarFactura>',
    );
  });

  it('parses tramitacion + anulacion as two independent status tracks', async () => {
    const http = mockHttp({ status: 200, data: CONSULTAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    const result = await client.consultarFactura('2016/000000001');
    expect(result.codigo).toBe('0');
    expect(result.numeroRegistro).toBe('2016/000000001');
    expect(result.tramitacion).toEqual({ codigo: '1200', descripcion: 'Registrada', motivo: undefined });
    expect(result.anulacion).toEqual({
      codigo: '4100',
      descripcion: 'No solicita anulación',
      motivo: undefined,
    });
  });

  it('parses correctly regardless of SOAP namespace prefix (ns1: vs default xmlns)', async () => {
    const http = mockHttp({ status: 200, data: CONSULTAR_FACTURA_RESPONSE_NS1_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    const result = await client.consultarFactura('2026/000000042');
    expect(result.tramitacion?.codigo).toBe('2600');
    expect(result.tramitacion?.descripcion).toBe('Rechazada');
    expect(result.tramitacion?.motivo).toBe('Factura duplicada');
  });

  it('throws when the HTTP transport reports an error status', async () => {
    const http = mockHttp({ status: 404, data: '' });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await expect(client.consultarFactura('2016/1')).rejects.toThrow(/consultarFactura failed \(HTTP 404\)/);
  });
});

describe('mapFaceEstado — official estado code table (Gipuzkoa PGEFe manual §5)', () => {
  it('1200 Registrada / 1300 Registrada en RCF → PENDING (still processing)', () => {
    expect(mapFaceEstado('1200')).toBe('PENDING');
    expect(mapFaceEstado('1300')).toBe('PENDING');
  });

  it('2400 Contabilizada / 2500 Pagada → CLEARED (accepted for payment)', () => {
    expect(mapFaceEstado('2400')).toBe('CLEARED');
    expect(mapFaceEstado('2500')).toBe('CLEARED');
  });

  it('2600 Rechazada → REJECTED', () => {
    expect(mapFaceEstado('2600')).toBe('REJECTED');
  });

  it('3100 Anulada → REJECTED (invoice void, not a valid delivered invoice)', () => {
    expect(mapFaceEstado('3100')).toBe('REJECTED');
  });

  it('unknown/missing codigo → PENDING (never guess a terminal state)', () => {
    expect(mapFaceEstado('9999')).toBe('PENDING');
    expect(mapFaceEstado(undefined)).toBe('PENDING');
  });

  it('every tramitacion/anulacion code in the reference tables is documented', () => {
    expect(Object.keys(FACE_TRAMITACION_ESTADOS).sort()).toEqual(
      ['1200', '1300', '2400', '2500', '2600', '3100'].sort(),
    );
    expect(Object.keys(FACE_ANULACION_ESTADOS).sort()).toEqual(['4100', '4200', '4300', '4400'].sort());
  });
});
