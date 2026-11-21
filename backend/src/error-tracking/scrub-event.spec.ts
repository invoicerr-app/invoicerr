import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { redactText, redactUrl } from '../logger/redaction-rules';
import { scrubEvent } from './scrub-event';

function event(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...overrides } as ErrorEvent;
}

describe('scrubEvent', () => {
  it('drops the user, including an IP address or the {{auto}} marker', () => {
    expect(scrubEvent(event({ user: { id: 'u1', ip_address: '203.0.113.7' } })).user).toBeUndefined();
    expect(scrubEvent(event({ user: { ip_address: '{{auto}}' } })).user).toBeUndefined();
  });

  it('keeps only the method of the request: no URL, body, cookies, headers or query', () => {
    const scrubbed = scrubEvent(
      event({
        request: {
          method: 'POST',
          url: 'https://app.example.test/api/clients/c123?token=abc#frag',
          data: '{"password":"hunter2"}',
          cookies: { session: 'secret' },
          headers: { authorization: 'Bearer abc', cookie: 'session=abc', 'x-forwarded-for': '203.0.113.7' },
          query_string: 'token=abc',
          env: { REMOTE_ADDR: '203.0.113.7' },
        },
      }),
    );
    expect(scrubbed.request).toEqual({ method: 'POST' });
  });

  it('drops breadcrumbs and the host name', () => {
    const scrubbed = scrubEvent(
      event({ breadcrumbs: [{ message: 'mail to someone@example.test' }], server_name: 'pod-1' }),
    );
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
  });

  it('never sends the text of an error: only its type, and the stack trace stays', () => {
    const error = new Error('Client ACME SARL, 12 rue X, 1 234,56 EUR');
    const frames = [{ function: 'createInvoice', filename: 'app:///dist/invoices.js', lineno: 12 }];
    const scrubbed = scrubEvent(
      event({
        message: error.message,
        logentry: { message: error.message },
        exception: { values: [{ type: 'Error', value: error.message, stacktrace: { frames } }] },
      }),
      { originalException: error },
    );
    const serialized = JSON.stringify(scrubbed);
    for (const leaked of ['ACME', 'SARL', '12 rue', 'rue X', '1 234,56', 'EUR']) {
      expect(serialized).not.toContain(leaked);
    }
    expect(scrubbed.exception?.values?.[0].value).toBe('Error');
    expect(scrubbed.message).toBe('Error');
    expect(scrubbed.logentry).toBeUndefined();
    expect(scrubbed.exception?.values?.[0].stacktrace?.frames).toEqual(frames);
  });

  it('keeps the code of a business error and the status of an HTTP exception, never their text', () => {
    const business = Object.assign(new Error('Company Boulangerie Martin is blocked'), {
      code: 'COMPANY_BLOCKED',
    });
    const businessEvent = event({ exception: { values: [{ type: 'Error', value: business.message }] } });
    const scrubbedBusiness = scrubEvent(businessEvent, { originalException: business });
    expect(scrubbedBusiness.exception?.values?.[0].value).toBe('Error COMPANY_BLOCKED');

    const http = Object.assign(new Error('Invoice for ACME SARL could not be rendered'), {
      name: 'InternalServerErrorException',
      getStatus: () => 500,
    });
    const scrubbed = scrubEvent(
      event({
        message: http.message,
        exception: { values: [{ type: 'InternalServerErrorException', value: http.message }] },
      }),
      { originalException: http },
    );
    expect(scrubbed.exception?.values?.[0].value).toBe('InternalServerErrorException 500');
    expect(scrubbed.message).toBe('InternalServerErrorException 500');
  });

  it('summarizes each error of a cause chain with its own code', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
    const error = new Error('Saving the invoice of ACME failed', { cause });
    const scrubbed = scrubEvent(
      event({
        exception: {
          values: [
            { type: 'Error', value: cause.message },
            { type: 'Error', value: error.message },
          ],
        },
      }),
      { originalException: error },
    );
    const values = scrubbed.exception?.values?.map((value) => value.value);
    expect(values).toEqual(['Error ECONNREFUSED', 'Error']);
  });

  it('replaces a message with no exception and no type by [redacted]', () => {
    expect(scrubEvent(event({ message: 'Client ACME SARL' })).message).toBe('[redacted]');
    const untyped = scrubEvent(event({ exception: { values: [{ value: 'Client ACME SARL' }] } }));
    expect(untyped.exception?.values?.[0].value).toBe('[redacted]');
  });

  it('still redacts extra with the shared rules', () => {
    const scrubbed = scrubEvent(
      event({ extra: { email: 'someone@example.test', note: 'call +33 6 12 34 56 78', count: 3 } }),
    );
    expect(scrubbed.extra).toEqual({ email: '[redacted]', note: 'call [redacted-phone]', count: 3 });
  });

  it('removes stack frame variables', () => {
    const scrubbed = scrubEvent(
      event({
        exception: {
          values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ vars: { iban: 'x' } }] } }],
        },
      }),
    );
    expect(scrubbed.exception?.values?.[0].stacktrace?.frames?.[0].vars).toBeUndefined();
  });

  it('keeps only the listed contexts, and drops every other one', () => {
    const scrubbed = scrubEvent(
      event({
        contexts: {
          custom: { password: 'hunter2' },
          client: { name: 'Acme' },
          culture: { timezone: 'Europe/Paris' },
          runtime: { name: 'node' },
          os: { name: 'linux' },
        },
      }),
    );
    expect(scrubbed.contexts).toEqual({ runtime: { name: 'node' }, os: { name: 'linux' } });
  });

  it('keeps only the name and code of a database error', () => {
    const error = Object.assign(new Error('Unique constraint failed on (`email`) = (someone@example.test)'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['email'] },
    });
    const scrubbed = scrubEvent(
      event({ exception: { values: [{ type: 'PrismaClientKnownRequestError', value: error.message }] } }),
      { originalException: error },
    );
    expect(scrubbed.exception?.values?.[0]).toEqual({
      type: 'PrismaClientKnownRequestError',
      value: 'PrismaClientKnownRequestError P2002',
    });
  });

  it('keeps only the type of a database error without a code', () => {
    const scrubbed = scrubEvent(
      event({
        exception: { values: [{ type: 'PrismaClientValidationError', value: 'Argument name: "Acme SAS"' }] },
      }),
    );
    expect(scrubbed.exception?.values?.[0].value).toBe('PrismaClientValidationError');
  });
});

describe('shared text rules', () => {
  it('redacts IBANs, grouped or not', () => {
    expect(redactText('pay to FR76 3000 6000 0112 3456 7890 189 now')).toBe('pay to [redacted-iban] now');
    expect(redactText('iban DE89370400440532013000.')).toBe('iban [redacted-iban].');
  });

  it('leaves an upper-case word followed by a number alone', () => {
    expect(redactText('ID12 USER NAME failed')).toBe('ID12 USER NAME failed');
  });

  it('redacts SIREN and SIRET numbers', () => {
    expect(redactText('company 732829320 not found')).toBe('company [redacted-company-id] not found');
    expect(redactText('siret 732 829 320 00074 invalid')).toBe('siret [redacted-company-id] invalid');
    expect(redactText('siret 73282932000074')).toBe('siret [redacted-company-id]');
  });

  it('redacts phone numbers in international and national form', () => {
    expect(redactText('call +33 6 12 34 56 78')).toBe('call [redacted-phone]');
    expect(redactText('call +44 (0)20 7946 0958')).toBe('call [redacted-phone]');
    expect(redactText('call 06.12.34.56.78 or 0612345678')).toBe('call [redacted-phone] or [redacted-phone]');
  });

  it('leaves dates, amounts, timestamps and uuids alone', () => {
    const text =
      'at 2026-11-21T10:00:00Z total 1234.56 ts 1763719200000 id 3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b';
    expect(redactText(text)).toBe(text);
  });

  it('redacts capability tokens in a URL path and drops the query', () => {
    expect(redactUrl('https://eu.invoicerr.app/portal/0123456789abcdef0123456789abcdef/invoices?x=1#y')).toBe(
      'https://eu.invoicerr.app/portal/[redacted-secret]/invoices',
    );
    expect(redactUrl('/signature/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(
      '/signature/[redacted-secret]',
    );
    expect(redactUrl(undefined)).toBeUndefined();
  });
});
