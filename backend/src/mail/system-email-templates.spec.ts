import { MailTemplateType } from '../../prisma/generated/prisma/client';

import { renderEmailTemplate } from '@/modules/documents/actions/email-template';

import {
  describeSystemEmailVocabulary,
  resolveSystemEmailTemplate,
  SYSTEM_EMAIL_DEFAULTS,
  SYSTEM_EMAIL_FAMILIES,
  systemEmailFamilyLabel,
} from './system-email-templates';

const APP_URL = 'https://invoicerr.test';

describe('the shipped system email templates', () => {
  it('ships a complete template for EVERY family — no family can exist without one', () => {
    expect(SYSTEM_EMAIL_FAMILIES).toEqual([
      MailTemplateType.SIGNATURE_REQUEST,
      MailTemplateType.VERIFICATION_CODE,
    ]);

    for (const family of SYSTEM_EMAIL_FAMILIES) {
      const template = SYSTEM_EMAIL_DEFAULTS[family];
      expect(template.subject.trim()).not.toBe('');
      // Both parts written by hand, not derived: prose written for a text reader beats prose stripped
      // out of markup (see this module's own header).
      expect(template.body.trim()).not.toBe('');
      expect(template.html?.trim()).not.toBe('');
    }
  });

  /**
   * The guard that matters most: the copy this application ships must not itself contain a placeholder
   * the sender cannot fill. Rendering each default against the SAME vocabulary its own sender builds
   * (`describeSystemEmailVocabulary` wraps the very parts builders the service calls) proves every
   * `{token}` in subject, text body and html is one that really gets substituted — a renamed variable in
   * one place and not the other shows up here rather than as a literal `{signatureUrl}` in someone's
   * inbox.
   */
  it.each(SYSTEM_EMAIL_FAMILIES)('has no unresolvable placeholder anywhere in %s', (family) => {
    const rendered = renderEmailTemplate(
      SYSTEM_EMAIL_DEFAULTS[family],
      describeSystemEmailVocabulary(family, APP_URL),
    );

    expect(rendered.warnings).toEqual([]);
    expect(rendered.subject).not.toMatch(/[{}]/);
    expect(rendered.body).not.toMatch(/[{}]/);
    expect(rendered.html).not.toMatch(/\{[a-zA-Z]/);
  });

  it('uses the single-brace vocabulary, never the retired double-brace one', () => {
    for (const family of SYSTEM_EMAIL_FAMILIES) {
      const template = SYSTEM_EMAIL_DEFAULTS[family];
      const everything = `${template.subject}${template.body}${template.html ?? ''}`;
      expect(everything).not.toContain('{{');
    }
  });

  it('keeps the signature link clickable in the html part', () => {
    expect(SYSTEM_EMAIL_DEFAULTS[MailTemplateType.SIGNATURE_REQUEST].html).toContain('href="{signatureUrl}"');
  });
});

describe('resolveSystemEmailTemplate — company override > shipped default', () => {
  it('returns the shipped default when the company has no row at all', () => {
    expect(resolveSystemEmailTemplate(MailTemplateType.VERIFICATION_CODE, null)).toBe(
      SYSTEM_EMAIL_DEFAULTS[MailTemplateType.VERIFICATION_CODE],
    );
    expect(resolveSystemEmailTemplate(MailTemplateType.SIGNATURE_REQUEST, undefined)).toBe(
      SYSTEM_EMAIL_DEFAULTS[MailTemplateType.SIGNATURE_REQUEST],
    );
  });

  it("maps a company's row onto the html part, leaving the text part for the engine to derive", () => {
    const resolved = resolveSystemEmailTemplate(MailTemplateType.SIGNATURE_REQUEST, {
      subject: 'Signez {signatureNumber}',
      body: '<p>Bonjour,</p><p><a href="{signatureUrl}">Signer</a></p>',
    });

    expect(resolved).toEqual({
      subject: 'Signez {signatureNumber}',
      body: '',
      html: '<p>Bonjour,</p><p><a href="{signatureUrl}">Signer</a></p>',
    });

    // ... and the engine really does produce a text part from it, so a customised row is never sent
    // html-only.
    const rendered = renderEmailTemplate(
      resolved,
      describeSystemEmailVocabulary(MailTemplateType.SIGNATURE_REQUEST, APP_URL),
    );
    expect(rendered.body).toContain('Bonjour,');
    expect(rendered.body).toContain(`${APP_URL}/signature/`);
    expect(rendered.html).toContain('<a href=');
  });
});

describe('describeSystemEmailVocabulary', () => {
  it('offers exactly what the signature-request sender substitutes', () => {
    const vocabulary = describeSystemEmailVocabulary(MailTemplateType.SIGNATURE_REQUEST, APP_URL);

    expect(Object.keys(vocabulary).sort()).toEqual([
      'appUrl',
      'signatureId',
      'signatureNumber',
      'signatureUrl',
    ]);
    expect(vocabulary.appUrl).toBe(APP_URL);
    expect(vocabulary.signatureUrl).toContain(`${APP_URL}/signature/`);
  });

  it('offers exactly what the verification-code sender substitutes, with the DISPLAY form of the code', () => {
    const vocabulary = describeSystemEmailVocabulary(MailTemplateType.VERIFICATION_CODE, APP_URL);

    expect(Object.keys(vocabulary).sort()).toEqual(['appUrl', 'otpCode']);
    // The "XXXX-XXXX" split is cosmetic, and a sample value is the one place it is safe to show one.
    expect(vocabulary.otpCode).toMatch(/^\d{4}-\d{4}$/);
  });

  it('is deterministic — the same preview twice, never a freshly random sample', () => {
    expect(describeSystemEmailVocabulary(MailTemplateType.SIGNATURE_REQUEST, APP_URL)).toEqual(
      describeSystemEmailVocabulary(MailTemplateType.SIGNATURE_REQUEST, APP_URL),
    );
  });
});

describe('systemEmailFamilyLabel', () => {
  it('reads as a human name, not an enum member', () => {
    expect(systemEmailFamilyLabel(MailTemplateType.SIGNATURE_REQUEST)).toBe('Signature Request');
    expect(systemEmailFamilyLabel(MailTemplateType.VERIFICATION_CODE)).toBe('Verification Code');
  });
});
