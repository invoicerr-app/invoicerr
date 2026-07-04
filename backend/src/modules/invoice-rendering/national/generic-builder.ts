/**
 * Generic national XML fallback for countries without a dedicated skeleton.
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';
import { sumNet, sumVat, isoDate } from './xml-helpers';

export function buildGenericNationalXml(data: InvoiceRenderData, cc: string): string {
        const issueDate = isoDate(data);
        const total = sumNet(data.items);
        const totalIVA = sumVat(data.items);
        return `<!-- TODO: ${cc} national e-invoice — schema and submission service TBD -->
<NationalInvoice>
  <Header><CountryCode>${cc}</CountryCode><InvoiceNumber>${data.rawNumber || 'DRAFT'}</InvoiceNumber><IssueDate>${issueDate}</IssueDate><Currency>${data.company.currency}</Currency></Header>
  <Seller><Name>${data.company.name}</Name><Identifier>${getIdentifier(data.company, 'VAT') || ''}</Identifier><Country>${data.company.country || ''}</Country></Seller>
  <Buyer><Name>${data.client.name}</Name><Identifier>${getIdentifier(data.client, 'VAT') || ''}</Identifier><Country>${data.client.country || ''}</Country></Buyer>
  <Lines>${data.items.map((item, i) => `<Line><Number>${i + 1}</Number><Description>${item.name}</Description><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice><VATRate>${item.vatRate || 0}</VATRate></Line>`).join('')}</Lines>
  <Totals><SubTotal>${total.toFixed(2)}</SubTotal><Tax>${totalIVA.toFixed(2)}</Tax><Total>${(total + totalIVA).toFixed(2)}</Total></Totals>
</NationalInvoice>
<!-- TODO: Country-specific schema validation + digital signature + submission -->`;
}
