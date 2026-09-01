import * as Handlebars from 'handlebars';

import { getVatDisplayContext, isVatApplicable } from './financial';
import { baseTemplate as invoiceTemplate } from '@/modules/invoices/templates/base.template';
import { baseTemplate as quoteTemplate } from '@/modules/quotes/templates/base.template';

describe('isVatApplicable', () => {
    it('hides VAT when the rate is 0 / not applicable (USA)', () => {
        expect(isVatApplicable(0, [{ vatRate: 0 }])).toBe(false);
        expect(isVatApplicable(0, [{ vatRate: 0 }, { vatRate: null }])).toBe(false);
        expect(isVatApplicable(0, [])).toBe(false);
        expect(isVatApplicable(0)).toBe(false);
        expect(isVatApplicable(null, undefined)).toBe(false);
    });

    it('keeps VAT when a real rate applies', () => {
        expect(isVatApplicable(200, [{ vatRate: 20 }])).toBe(true);
        expect(isVatApplicable(0, [{ vatRate: 5.5 }])).toBe(true);
        expect(isVatApplicable(0, [{ vatRate: 0 }, { vatRate: 20 }])).toBe(true);
        expect(isVatApplicable(12.5, [])).toBe(true);
    });
});

describe('getVatDisplayContext', () => {
    it('uses a 4-column totals colspan when VAT is hidden', () => {
        expect(getVatDisplayContext(0, [{ vatRate: 0 }])).toEqual({
            showVat: false,
            totalsColspan: 4,
        });
    });

    it('uses a 5-column totals colspan when VAT is shown', () => {
        expect(getVatDisplayContext(20, [{ vatRate: 20 }])).toEqual({
            showVat: true,
            totalsColspan: 5,
        });
    });
});

const pdfLabels = {
    invoice: 'Invoice',
    quote: 'Quote',
    date: 'Date',
    dueDate: 'Due date',
    validUntil: 'Valid until',
    billTo: 'Bill to',
    quoteFor: 'Quote for',
    description: 'Description',
    type: 'Type',
    quantity: 'Quantity',
    unitPrice: 'Unit price',
    vatRate: 'VAT Rate',
    total: 'Total',
    subtotal: 'Subtotal',
    vat: 'VAT',
    grandTotal: 'Grand Total',
};

function renderTemplate(source: string, showVat: boolean) {
    const { totalsColspan } = getVatDisplayContext(showVat ? 20 : 0, [{ vatRate: showVat ? 20 : 0 }]);
    return Handlebars.compile(source)({
        number: '1',
        date: '01/01/2026',
        dueDate: '31/01/2026',
        validUntil: '31/01/2026',
        company: { name: 'Acme', address: '1 Main', city: 'NY', postalCode: '10001', country: 'USA', email: 'a@a.com', phone: '1' },
        client: { name: 'Jane', address: '2 Main', city: 'LA', postalCode: '90001', country: 'USA' },
        currency: 'USD',
        items: [{ name: 'Work', type: 'Service', quantity: '1', unitPrice: '100.00', vatRate: showVat ? '20.00' : '0.00', totalPrice: showVat ? '120.00' : '100.00' }],
        totalHT: '100.00',
        totalVAT: showVat ? '20.00' : '0.00',
        totalTTC: showVat ? '120.00' : '100.00',
        subtotalBeforeDiscount: '100.00',
        showVat,
        totalsColspan,
        labels: pdfLabels,
    });
}

describe('PDF VAT columns', () => {
    it.each([
        ['invoice', invoiceTemplate],
        ['quote', quoteTemplate],
    ])('omits VAT rate and VAT total on %s PDFs when VAT is 0', (_kind, template) => {
        const html = renderTemplate(template, false);
        expect(html).not.toContain('VAT Rate');
        expect(html).not.toMatch(/>\s*VAT\s*</);
        expect(html).not.toContain('Grand Total');
        expect(html).toContain('Total');
        expect(html).toContain('100.00');
    });

    it.each([
        ['invoice', invoiceTemplate],
        ['quote', quoteTemplate],
    ])('keeps VAT rate and VAT total on %s PDFs when a real rate applies', (_kind, template) => {
        const html = renderTemplate(template, true);
        expect(html).toContain('VAT Rate');
        expect(html).toContain('20.00');
        expect(html).toMatch(/>\s*VAT\s*</);
        expect(html).toContain('Grand Total');
        expect(html).toContain('120.00');
    });
});
