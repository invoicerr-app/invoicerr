/**
 * FaceClient tests — fully offline/mocked (no real SOAP calls). REPRISED from
 * `avant-refonte-documents`'s `compliance/providers/transmission/face-client.spec.ts` (same fixtures,
 * same estado-table assertions), ADAPTED for the xmlbuilder2-based envelope builders (see
 * `face-client.ts`'s own header): the exact serialized string differs from the repère's hand-rolled
 * concatenation (self-closing empty elements, no space before "/>"), so the request-shape assertions
 * below check STRUCTURE (the right tags/values are present) rather than a byte-identical string.
 *
 * The response fixtures are taken verbatim (structure + field names) from the Diputación Foral de
 * Gipuzkoa "Servicios para sistemas Automatizados de proveedores..." v1.0.3 manual, exactly as the
 * repère's own spec documents — not re-fetched by this task.
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

/** Same consultarFacturaResponse but with an ns1: prefix — proves the parser is namespace-prefix
 *  agnostic (REPRISED verbatim from the repère). */
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
  it('builds the SOAP body with correo/factura/nombre/mime in the verified SSPP shape (xmlbuilder2)', async () => {
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
    expect(body).toContain('web:enviarFactura');
    expect(body).toContain('xmlns:web="https://webservice.face.gob.es"');
    expect(body).toContain('<correo>facturacion@empresa.es</correo>');
    expect(body).toContain('<factura>QUJD</factura>');
    expect(body).toContain('<nombre>invoice-42.xml</nombre>');
    expect(body).toContain('<mime>application/xml</mime>');
  });

  it('escapes XML-significant characters in correo/nombre (xmlbuilder2 does this for us)', async () => {
    const http = mockHttp({ status: 200, data: ENVIAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await client.enviarFactura({
      correo: 'a&b<c>@empresa.es',
      facturaBase64: 'QUJD',
      facturaNombre: 'inv "1" & 2.xml',
    });
    const body = http.post.mock.calls[0][2] as string;
    expect(body).toContain('a&amp;b&lt;c&gt;@empresa.es');
    expect(body).toContain('inv "1" &amp; 2.xml');
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
    expect(body).toContain('<anexo>WFla</anexo>');
    expect(body).toContain('<nombre>anexo1.pdf</nombre>');
    expect(body).toContain('<mime>application/pdf</mime>');
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

  it('throws (naming the HTTP status) when the transport reports an error status AND the body is not even parseable', async () => {
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

  // REAL, OBSERVED behaviour (this task, 2026-09-02) — see `face-client.ts#enviarFactura`'s own
  // header: the live sandbox (`se-face-webservice.redsara.es`) answers an UNSIGNED request with
  // HTTP 500 carrying a REAL SOAP Fault, `faultcode` 401, `faultstring` "La petición no esta
  // firmada". A client that discarded the body behind a bare "HTTP 500" would lose exactly the
  // information that confirms the WS-Security gap — this proves it does NOT.
  it('HTTP 500 WITH a real SOAP Fault body surfaces the faultstring, never just the bare HTTP code (live-observed shape)', async () => {
    const realObservedFaultXml =
      '<?xml version="1.0"?>' +
      '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<SOAP-ENV:Header/>' +
      '<SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>401</faultcode>' +
      '<faultstring>La petición no esta firmada</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body>' +
      '</SOAP-ENV:Envelope>';
    const http = mockHttp({ status: 500, data: realObservedFaultXml });
    const client = new FaceClient({ endpoint: 'x' }, http);
    await expect(
      client.enviarFactura({ correo: 'a@b.es', facturaBase64: 'QUJD', facturaNombre: 'inv.xml' }),
    ).rejects.toThrow(/La petición no esta firmada/);
  });

  // MUTATION TARGET — the hard-success contract this task's own `face-transport.ts` enforces on TOP
  // of this client's own parsing: a `numeroRegistro` field can legitimately be absent from a parsed
  // result (e.g. a rejected `codigo`) — this client itself never invents one, never treats an empty
  // string as present.
  it('a response with codigo !== "0" still parses — numeroRegistro is simply absent, never fabricated', async () => {
    const rejectedXml = envelope(
      '<enviarFacturaResponse xmlns="https://webservice.face.gob.es"><return>' +
        '<resultado><codigo>033</codigo><descripcion>certificado caducado</descripcion></resultado>' +
        '</return></enviarFacturaResponse>',
    );
    const http = mockHttp({ status: 200, data: rejectedXml });
    const client = new FaceClient({ endpoint: 'x' }, http);
    const result = await client.enviarFactura({
      correo: 'a@b.es',
      facturaBase64: 'QUJD',
      facturaNombre: 'inv.xml',
    });
    expect(result.codigo).toBe('033');
    expect(result.numeroRegistro).toBeUndefined();
  });
});

describe('FaceClient.consultarFactura', () => {
  it('builds the SOAP body with numeroRegistro in the verified SSPP shape', async () => {
    const http = mockHttp({ status: 200, data: CONSULTAR_FACTURA_RESPONSE_XML });
    const client = new FaceClient({ endpoint: 'https://webservice.face.gob.es/facturasspp2' }, http);
    await client.consultarFactura('2016/000000001');
    const [endpoint, operation, body] = http.post.mock.calls[0];
    expect(endpoint).toBe('https://webservice.face.gob.es/facturasspp2');
    expect(operation).toBe('consultarFactura');
    expect(body).toContain('web:consultarFactura');
    expect(body).toContain('<numeroRegistro>2016/000000001</numeroRegistro>');
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
