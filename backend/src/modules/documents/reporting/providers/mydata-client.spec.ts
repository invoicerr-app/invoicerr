import { parseMyDataResponse } from './mydata-client';

describe("parseMyDataResponse — the vendored response XSD shape (mydata-client.ts's own header)", () => {
  it('reads a success response: invoiceMark/invoiceUid/statusCode, no errors', () => {
    const xml =
      '<ResponseDoc><response><index>1</index><invoiceUid>UID123</invoiceUid>' +
      '<invoiceMark>400000000000001</invoiceMark><statusCode>Success</statusCode></response></ResponseDoc>';

    const item = parseMyDataResponse(xml);

    expect(item).toEqual({
      index: 1,
      invoiceUid: 'UID123',
      invoiceMark: '400000000000001',
      statusCode: 'Success',
      errors: [],
    });
  });

  it('reads an error response: errors[] with code/message, no invoiceMark', () => {
    const xml =
      '<ResponseDoc><response><index>1</index><statusCode>ValidationError</statusCode>' +
      '<errors><error><code>101</code><message>Invalid VAT number</message></error></errors></response></ResponseDoc>';

    const item = parseMyDataResponse(xml);

    expect(item.invoiceMark).toBeUndefined();
    expect(item.errors).toEqual([{ code: '101', message: 'Invalid VAT number' }]);
  });

  it('is namespace-prefix agnostic (a real AADE response wraps everything in a namespace)', () => {
    const xml =
      '<ns:ResponseDoc xmlns:ns="https://www.aade.gr/myDATA/response/v1.0">' +
      '<ns:response><ns:invoiceMark>777</ns:invoiceMark><ns:statusCode>Success</ns:statusCode></ns:response>' +
      '</ns:ResponseDoc>';

    expect(parseMyDataResponse(xml).invoiceMark).toBe('777');
  });

  it('throws on content with no usable root element, never returns a half-parsed guess', () => {
    expect(() => parseMyDataResponse('this is not XML at all')).toThrow(/could not be parsed/);
  });

  it('throws when there is no <response> element at all', () => {
    expect(() => parseMyDataResponse('<ResponseDoc></ResponseDoc>')).toThrow(/no <response>/);
  });
});
