/**
 * The readable half of the obligation.
 *
 * C. com. art. L441-9 is about what the invoice SAYS, so carrying the mentions in the XML is not
 * enough on its own: the document the client actually reads has to state them too. This asserts the
 * template output rather than a rendered PDF — the PDF is that HTML through a printer, and testing
 * the HTML is what tells us whether the text is there.
 */
import * as Handlebars from 'handlebars';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import { resolveInvoiceNotes } from '@/compliance/profiles/invoice-notes';
import { defaultRegistry } from '@/compliance/profiles/registry';

const render = (ctx: Record<string, unknown>) =>
  Handlebars.compile(baseTemplate)({
    number: 'INV-1',
    date: '02/09/2026',
    currency: 'EUR',
    company: { name: 'Seller', country: 'France' },
    client: { name: 'Buyer', country: 'France' },
    items: [],
    labels: {},
    ...ctx,
  });

describe('legal mentions on the printed invoice', () => {
  const mentions = () =>
    resolveInvoiceNotes(defaultRegistry.resolve('FR').profile, new Date('2026-09-02')).map((n) => n.text);

  it('a French invoice prints the three mentions of L441-9 I al. 5', () => {
    const html = render({ legalMentions: mentions(), legalMentionsExist: true });
    expect(html).toContain('40 €'); // indemnité forfaitaire, D441-5
    expect(html).toContain('12,40 %'); // taux supplétif du 2e semestre 2026
    expect(html).toContain('Escompte pour paiement anticipé : néant');
  });

  it('they sit in their own block, not among the user notes', () => {
    // The notes above belong to the user and can be emptied; these cannot. Mixing them would let a
    // user delete a mention whose absence is an administrative offence.
    const html = render({
      legalMentions: mentions(),
      legalMentionsExist: true,
      noteExists: true,
      notes: 'Merci de votre confiance',
    });
    expect(html).toContain('class="legal-mentions"');
    expect(html.indexOf('Merci de votre confiance')).toBeLessThan(html.indexOf('class="legal-mentions"'));
  });

  it('a country that requires none prints no block at all', () => {
    // Not an empty framed section with nothing in it — nothing.
    const html = render({ legalMentions: [], legalMentionsExist: false });
    expect(html).not.toContain('class="legal-mentions"');
  });

  it('the printed rate is the one of the issue date', () => {
    const march = resolveInvoiceNotes(defaultRegistry.resolve('FR').profile, new Date('2026-03-01')).map(
      (n) => n.text,
    );
    const html = render({ legalMentions: march, legalMentionsExist: true });
    expect(html).toContain('12,15 %');
    expect(html).not.toContain('12,40 %');
  });
});
