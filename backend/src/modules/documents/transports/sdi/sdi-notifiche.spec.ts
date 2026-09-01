/**
 * `sdi-notifiche.ts` (pure parsing) in isolation — see that file's own header for the WSDL/XSD
 * sources this is built from. One example XML per notifica type, built directly from the read
 * `fileSdI_Type` shape (`IdentificativoSdI`, `NomeFile`, `File`) under each of the six root elements
 * — never a fabricated INNER structure (the base64 `File` content itself is opaque, per that file's
 * own header on what was NOT read).
 */
import { NOTIFICA_ELEMENT_TO_TYPE, parseSdiNotifica } from './sdi-notifiche';

function notificaXml(rootElement: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <ns:${rootElement} xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
          <ns:IdentificativoSdI>123456789012</ns:IdentificativoSdI>
          <ns:NomeFile>IT01234567890_0000000001.xml</ns:NomeFile>
          <ns:File>PGZvbz48L2Zvbz4=</ns:File>
        </ns:${rootElement}>
      </soap:Body>
    </soap:Envelope>`;
}

describe('parseSdiNotifica', () => {
  it.each(
    Object.entries(NOTIFICA_ELEMENT_TO_TYPE),
  )('recognizes <%s> as notifica type %s and extracts IdentificativoSdI/NomeFile/File', (rootElement, expectedType) => {
    const parsed = parseSdiNotifica(notificaXml(rootElement));
    expect(parsed).toEqual({
      notificaType: expectedType,
      identificativoSdI: '123456789012',
      nomeFile: 'IT01234567890_0000000001.xml',
      fileBase64: 'PGZvbz48L2Zvbz4=',
    });
  });

  it('returns null for malformed XML — never throws (the controller always answers 200 regardless)', () => {
    expect(parseSdiNotifica('<not-xml')).toBeNull();
  });

  it('returns null for well-formed XML that matches none of the six known operations', () => {
    expect(
      parseSdiNotifica(
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><somethingElse/></soap:Body></soap:Envelope>',
      ),
    ).toBeNull();
  });

  it('returns null when a recognized root element is missing IdentificativoSdI', () => {
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <ns:ricevutaConsegna xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
          <ns:NomeFile>IT01234567890_0000000001.xml</ns:NomeFile>
          <ns:File>PGZvbz48L2Zvbz4=</ns:File>
        </ns:ricevutaConsegna>
      </soap:Body>
    </soap:Envelope>`;
    expect(parseSdiNotifica(xml)).toBeNull();
  });
});
