import { buildPortalInviteEmail } from './portal-invite-email';

const INPUT = { companyName: 'Acme Corp', portalUrl: 'https://app.test/portal/abc123' };

describe('buildPortalInviteEmail', () => {
  it('names the company and the portal URL, in English by default', () => {
    const email = buildPortalInviteEmail(INPUT);

    expect(email.subject).toContain('Acme Corp');
    expect(email.text).toContain('Hello,');
    expect(email.text).toContain(INPUT.portalUrl);
    expect(email.html).toContain(INPUT.portalUrl);
  });

  // Multilingual client-facing mail (step 4 of the multilingual-mail plan) — the invite reaches the
  // CLIENT, not a member of the inviting company, so it must follow the recipient's own language.
  it('builds a genuinely Italian invite for an Italian client, distinct from the English default', () => {
    const en = buildPortalInviteEmail({ ...INPUT, language: 'en' });
    const italian = buildPortalInviteEmail({ ...INPUT, language: 'it' });

    expect(italian.subject).toContain('accedi al tuo portale clienti');
    expect(italian.text).toContain('Salve,');
    expect(italian.text).toContain('Acme Corp'); // the company name is never translated
    expect(italian.text).toContain(INPUT.portalUrl);
    expect(italian.html).toContain('Accedi al portale'); // the button label
    expect(italian).not.toEqual(en);
  });

  it('translates into French, Polish, German and Portuguese too', () => {
    const expectations: Record<string, RegExp> = {
      fr: /accédez à votre portail client/,
      pl: /dostęp do portalu klienta/,
      de: /Zugang zu Ihrem Kundenportal/,
      pt: /aceda ao seu portal de cliente/,
    };
    for (const [language, subjectPattern] of Object.entries(expectations)) {
      const email = buildPortalInviteEmail({ ...INPUT, language: language as never });
      expect(email.subject).toMatch(subjectPattern);
      expect(email.text).toContain(INPUT.portalUrl);
    }
  });

  it('escapes the company name in the html part, but never in the plain-text part', () => {
    const email = buildPortalInviteEmail({ ...INPUT, companyName: 'Tom & Jerry <Ltd>', language: 'en' });

    expect(email.text).toContain('Tom & Jerry <Ltd>');
    expect(email.html).toContain('Tom &amp; Jerry &lt;Ltd&gt;');
    expect(email.html).not.toContain('Tom & Jerry <Ltd>');
  });

  it('falls back to English when the language is unsupported or unset — never a blocked send', () => {
    const defaulted = buildPortalInviteEmail(INPUT); // no `language` at all
    const unsupported = buildPortalInviteEmail({ ...INPUT, language: 'xx' as never });
    const en = buildPortalInviteEmail({ ...INPUT, language: 'en' });

    expect(defaulted).toEqual(en);
    expect(unsupported).toEqual(en);
  });
});
