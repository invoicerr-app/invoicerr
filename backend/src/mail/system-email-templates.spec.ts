import { MailTemplateType } from '../../prisma/generated/prisma/client';

import { renderEmailTemplate } from '@/modules/documents/actions/email-template';
import { SUPPORTED_RENDER_LANGUAGES } from '@/modules/documents/rendering/language/supported-languages';

import {
  buildBlockedZipWarningEmail,
  buildDeletionWarningEmail,
  buildLegalDocumentChangedEmail,
  buildOwnershipTransferEndedEmail,
  buildOwnershipTransferFinalizedEmail,
  buildOwnershipTransferRequestEmail,
  buildSystemEmailDefault,
  describeSystemEmailVocabulary,
  resolveSystemEmailTemplate,
  SYSTEM_EMAIL_FAMILIES,
  systemEmailFamilyLabel,
} from './system-email-templates';

const APP_URL = 'https://invoicerr.test';

describe('the shipped system email templates — every supported language', () => {
  it.each(SUPPORTED_RENDER_LANGUAGES)('ships a complete %s template for EVERY family', (language) => {
    for (const family of SYSTEM_EMAIL_FAMILIES) {
      const template = buildSystemEmailDefault(family, language);
      expect(template.subject.trim()).not.toBe('');
      // Both parts written by hand, not derived: prose written for a text reader beats prose stripped
      // out of markup (see this module's own header).
      expect(template.body.trim()).not.toBe('');
      expect(template.html?.trim()).not.toBe('');
    }
  });

  /**
   * The guard that matters most: the copy this application ships must not itself contain a placeholder
   * the sender cannot fill, IN ANY LANGUAGE. Rendering each default against the SAME vocabulary its own
   * sender builds (`describeSystemEmailVocabulary` wraps the very parts builders the service calls)
   * proves every `{token}` in subject, text body and html is one that really gets substituted — a
   * renamed variable in one place and not the other shows up here rather than as a literal
   * `{signatureUrl}` in someone's inbox.
   */
  it.each(
    SUPPORTED_RENDER_LANGUAGES.flatMap((language) =>
      SYSTEM_EMAIL_FAMILIES.map((f) => [language, f] as const),
    ),
  )('has no unresolvable placeholder anywhere in %s/%s', (language, family) => {
    const rendered = renderEmailTemplate(
      buildSystemEmailDefault(family, language),
      describeSystemEmailVocabulary(family, APP_URL),
    );

    expect(rendered.warnings).toEqual([]);
    expect(rendered.subject).not.toMatch(/[{}]/);
    expect(rendered.body).not.toMatch(/[{}]/);
    expect(rendered.html).not.toMatch(/\{[a-zA-Z]/);
    // Never a leftover i18next interpolation brace either — every `{{token}}` this file's own
    // catalog can carry (plural counts) is always resolved by `mailT` before the string reaches
    // here; only the single-brace, later-substituted vocabulary above may remain at this point.
    expect(rendered.subject).not.toContain('{{');
    expect(rendered.body).not.toContain('{{');
    expect(rendered.html).not.toContain('{{');
  });

  it('uses the single-brace vocabulary, never the retired double-brace one', () => {
    for (const family of SYSTEM_EMAIL_FAMILIES) {
      const template = buildSystemEmailDefault(family, 'en');
      const everything = `${template.subject}${template.body}${template.html ?? ''}`;
      expect(everything).not.toContain('{{');
    }
  });

  it('keeps the signature link clickable in the html part', () => {
    expect(buildSystemEmailDefault(MailTemplateType.SIGNATURE_REQUEST, 'en').html).toContain(
      'href="{signatureUrl}"',
    );
  });

  it('falls back to English for an unsupported/unknown language', () => {
    const known = buildSystemEmailDefault(MailTemplateType.VERIFICATION_CODE, 'en');
    // `mailT` itself resolves an unsupported code to English (see i18n.ts) — a family default built
    // from a raw, never-normalized string reaches the exact same shipped English copy.
    const unknown = buildSystemEmailDefault(MailTemplateType.VERIFICATION_CODE, 'xx' as never);
    expect(unknown).toEqual(known);
  });

  it('actually varies the wording per language — French is not a byte-for-byte copy of English', () => {
    const en = buildSystemEmailDefault(MailTemplateType.SIGNATURE_REQUEST, 'en');
    const fr = buildSystemEmailDefault(MailTemplateType.SIGNATURE_REQUEST, 'fr');
    expect(fr.subject).not.toBe(en.subject);
    expect(fr.subject).toContain('signer');
    expect(fr.html).toContain('Signature de document requise');
  });
});

describe('resolveSystemEmailTemplate — company override > shipped default, per language', () => {
  it('returns the shipped ENGLISH default when the company has no row and no language is given', () => {
    expect(resolveSystemEmailTemplate(MailTemplateType.VERIFICATION_CODE, null)).toEqual(
      buildSystemEmailDefault(MailTemplateType.VERIFICATION_CODE, 'en'),
    );
    expect(resolveSystemEmailTemplate(MailTemplateType.SIGNATURE_REQUEST, undefined)).toEqual(
      buildSystemEmailDefault(MailTemplateType.SIGNATURE_REQUEST, 'en'),
    );
  });

  it('returns the shipped default in the REQUESTED language when the company has no row', () => {
    expect(resolveSystemEmailTemplate(MailTemplateType.SIGNATURE_REQUEST, null, 'de')).toEqual(
      buildSystemEmailDefault(MailTemplateType.SIGNATURE_REQUEST, 'de'),
    );
  });

  it("maps a company's row onto the html part UNTRANSLATED, regardless of the requested language", () => {
    const override = {
      subject: 'Signez {signatureNumber}',
      body: '<p>Bonjour,</p><p><a href="{signatureUrl}">Signer</a></p>',
    };
    // 'de' requested, but the override is a company's own words — never translated out from under it.
    const resolved = resolveSystemEmailTemplate(MailTemplateType.SIGNATURE_REQUEST, override, 'de');

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

describe('OWNER warning emails (J-7/J-1 before the zip, and before the permanent deletion)', () => {
  it('buildBlockedZipWarningEmail names the day count and links to the billing settings screen (default: English)', () => {
    const email = buildBlockedZipWarningEmail({ appUrl: APP_URL, daysRemaining: 7 });
    expect(email.subject).toContain('7 days');
    expect(email.text).toContain(`${APP_URL}/settings/billing`);
    expect(email.html).toContain(`${APP_URL}/settings/billing`);
  });

  it('buildBlockedZipWarningEmail uses the singular "day" at J-1', () => {
    const email = buildBlockedZipWarningEmail({ appUrl: APP_URL, daysRemaining: 1 });
    expect(email.subject).toContain('1 day');
    expect(email.subject).not.toContain('1 days');
  });

  it('buildDeletionWarningEmail is unambiguous about permanent, irreversible deletion', () => {
    const email = buildDeletionWarningEmail({ appUrl: APP_URL, daysRemaining: 7 });
    expect(email.subject.toLowerCase()).toContain('permanently deleted');
    expect(email.text.toLowerCase()).toContain('cannot be undone');
    expect(email.text).toContain(`${APP_URL}/settings/billing`);
  });

  it('buildDeletionWarningEmail uses the singular "day" at J-1', () => {
    const email = buildDeletionWarningEmail({ appUrl: APP_URL, daysRemaining: 1 });
    expect(email.subject).toContain('1 day');
    expect(email.subject).not.toContain('1 days');
  });

  it('honors an explicit language — French pluralizes "jour"/"jours" correctly at J-1 and J-7', () => {
    const j1 = buildBlockedZipWarningEmail({ appUrl: APP_URL, daysRemaining: 1, language: 'fr' });
    const j7 = buildBlockedZipWarningEmail({ appUrl: APP_URL, daysRemaining: 7, language: 'fr' });
    expect(j1.subject).toContain('1 jour');
    expect(j1.subject).not.toContain('1 jours');
    expect(j7.subject).toContain('7 jours');

    const del1 = buildDeletionWarningEmail({ appUrl: APP_URL, daysRemaining: 1, language: 'fr' });
    const del7 = buildDeletionWarningEmail({ appUrl: APP_URL, daysRemaining: 7, language: 'fr' });
    expect(del1.text).toContain('1 jour,');
    expect(del7.text).toContain('7 jours,');
  });

  it('honors an explicit language — Polish uses its own "many" plural form at J-7', () => {
    const j7 = buildBlockedZipWarningEmail({ appUrl: APP_URL, daysRemaining: 7, language: 'pl' });
    expect(j7.subject).toContain('7 dni');
    const j1 = buildBlockedZipWarningEmail({ appUrl: APP_URL, daysRemaining: 1, language: 'pl' });
    expect(j1.subject).toContain('1 dzień');
  });
});

describe('buildLegalDocumentChangedEmail', () => {
  it('names the document, its version, and links to /legal/<slug> — singular subject for one document', () => {
    const email = buildLegalDocumentChangedEmail({
      appUrl: APP_URL,
      documents: [{ title: 'Terms of Service', version: '2026-09-17', slug: 'terms-of-service' }],
      requiresAcceptance: true,
    });

    expect(email.subject).toBe('Updated legal document: Terms of Service');
    expect(email.text).toContain('Terms of Service');
    expect(email.text).toContain('2026-09-17');
    expect(email.text).toContain(`${APP_URL}/legal/terms-of-service`);
    expect(email.html).toContain(`href="${APP_URL}/legal/terms-of-service"`);
  });

  it('mentions that re-acceptance will be asked for at the next sign-in, and links to /legal/accept, when required', () => {
    const email = buildLegalDocumentChangedEmail({
      appUrl: APP_URL,
      documents: [{ title: 'Privacy Policy', version: '2026-09-17', slug: 'privacy-policy' }],
      requiresAcceptance: true,
    });
    expect(email.text.toLowerCase()).toContain('next time you sign in');
    expect(email.text).toContain(`${APP_URL}/legal/accept`);
    expect(email.html).toContain(`href="${APP_URL}/legal/accept"`);
  });

  it('carries no call to action when none of the changed documents require re-acceptance', () => {
    const email = buildLegalDocumentChangedEmail({
      appUrl: APP_URL,
      documents: [{ title: 'Legal Notice', version: '2026-09-17', slug: 'legal-notice' }],
      requiresAcceptance: false,
    });
    expect(email.text).not.toContain('/legal/accept');
    expect(email.html).not.toContain('/legal/accept');
  });

  /** The actual bug this shape exists to prevent: several documents changed in the same pass must
   *  produce ONE email listing all of them, with a plural subject naming the first two and how many
   *  more, never a caller having to build one of these per document. */
  it('lists every document and uses a plural, summarized subject when several changed at once', () => {
    const email = buildLegalDocumentChangedEmail({
      appUrl: APP_URL,
      documents: [
        { title: 'Privacy Policy', version: '2026-09-17', slug: 'privacy-policy' },
        { title: 'Legal Notice', version: '2026-09-17', slug: 'legal-notice' },
        { title: 'Terms of Service', version: '2026-09-17', slug: 'terms-of-service' },
        { title: 'Cookies & Acceptable Use', version: '2026-09-17', slug: 'cookies-acceptable-use' },
      ],
      requiresAcceptance: true,
    });

    expect(email.subject).toBe('Updated legal documents: Privacy Policy, Legal Notice and 2 more');
    expect(email.text).toContain('Privacy Policy');
    expect(email.text).toContain('Legal Notice');
    expect(email.text).toContain('Terms of Service');
    expect(email.text).toContain('Cookies & Acceptable Use');
    expect(email.html).toContain(`href="${APP_URL}/legal/privacy-policy"`);
    expect(email.html).toContain(`href="${APP_URL}/legal/cookies-acceptable-use"`);
  });

  it('uses a two-item subject with no "and N more" when exactly two documents changed', () => {
    const email = buildLegalDocumentChangedEmail({
      appUrl: APP_URL,
      documents: [
        { title: 'Privacy Policy', version: '2026-09-17', slug: 'privacy-policy' },
        { title: 'Legal Notice', version: '2026-09-17', slug: 'legal-notice' },
      ],
      requiresAcceptance: false,
    });

    expect(email.subject).toBe('Updated legal documents: Privacy Policy and Legal Notice');
  });

  it('translates the surrounding prose in another language while document titles stay verbatim', () => {
    const email = buildLegalDocumentChangedEmail({
      appUrl: APP_URL,
      documents: [
        { title: 'Privacy Policy', version: '2026-09-17', slug: 'privacy-policy' },
        { title: 'Legal Notice', version: '2026-09-17', slug: 'legal-notice' },
      ],
      requiresAcceptance: false,
      language: 'it',
    });
    expect(email.subject).toBe('Documenti legali aggiornati: Privacy Policy e Legal Notice');
    expect(email.html).toContain('Abbiamo aggiornato i seguenti documenti legali:');
  });
});

/**
 * Unlike every template above (mailed to a company's own owner about their own account), these three
 * reach a DIFFERENT, unrelated user's inbox carrying values the INITIATING owner controls — their
 * company's own name, their own display name. The HTML part must escape them: an unescaped `<script>`/
 * `<img onerror>` planted in a company name would otherwise execute in the recipient's mail client the
 * moment they open a transfer request they never asked for. Checked in EVERY supported language, since
 * the escaping happens independently of which translated sentence wraps the value.
 */
describe('ownership transfer emails — HTML-escape attacker-reachable values, in every language', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>Acme "Corp" & Sons';
  const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;Acme &quot;Corp&quot; &amp; Sons';

  it.each(
    SUPPORTED_RENDER_LANGUAGES,
  )('buildOwnershipTransferRequestEmail escapes companyName and fromName in the HTML part only (%s)', (language) => {
    const email = buildOwnershipTransferRequestEmail({
      appUrl: APP_URL,
      companyName: PAYLOAD,
      fromName: PAYLOAD,
      language,
    });

    expect(email.html).not.toContain(PAYLOAD);
    expect(email.html).toContain(ESCAPED);
    // The plain-text part never renders HTML — raw is correct there, never escaped into entities.
    expect(email.text).toContain(PAYLOAD);
  });

  it.each(
    SUPPORTED_RENDER_LANGUAGES,
  )('buildOwnershipTransferFinalizedEmail escapes companyName in the HTML part only (%s)', (language) => {
    const email = buildOwnershipTransferFinalizedEmail({
      appUrl: APP_URL,
      companyName: PAYLOAD,
      forNewOwner: true,
      language,
    });

    expect(email.html).not.toContain(PAYLOAD);
    expect(email.html).toContain(ESCAPED);
    expect(email.text).toContain(PAYLOAD);
  });

  it.each(
    SUPPORTED_RENDER_LANGUAGES,
  )('buildOwnershipTransferEndedEmail escapes companyName and toEmail in the HTML part only (%s)', (language) => {
    const email = buildOwnershipTransferEndedEmail({
      appUrl: APP_URL,
      companyName: PAYLOAD,
      toEmail: PAYLOAD,
      reason: 'expired',
      language,
    });

    expect(email.html).not.toContain(PAYLOAD);
    expect(email.html).toContain(ESCAPED);
    expect(email.text).toContain(PAYLOAD);
  });

  it("buildOwnershipTransferFinalizedEmail also escapes the template's own quote marks around the name (EN)", () => {
    // The regression this test pins: `bodyLine` is composed FIRST, THEN escaped as a whole — the
    // literal quotes this template writes around `{companyName}` become `&quot;` too, exactly like the
    // pre-i18next code (`escapeHtml(bodyLine)`) always produced.
    const email = buildOwnershipTransferFinalizedEmail({
      appUrl: APP_URL,
      companyName: 'Acme Corp',
      forNewOwner: true,
    });
    expect(email.html).toContain('&quot;Acme Corp&quot;');
    expect(email.html).not.toContain('"Acme Corp"');
  });
});
