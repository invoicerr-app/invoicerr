export const baseTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{{labels.quote}} {{number}}</title>
    <style>
        body { font-family: {{fontFamily}}, sans-serif; margin: 0; color: #333; font-size: 13px; }
        .header { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; row-gap: 10px; margin-bottom: 30px; }
        .quote-info { text-align: right; }
        .header p { margin: 0; line-height: 1.4; }
        .client-info { text-align: left; }
        .client-info h3 { margin: 0 0 4px; }
        .client-info .name, .company-info .name { margin: 0 0 4px; font-weight: bold; }
        .company-info .spacer { visibility: hidden; margin: 0 0 4px; }
        .item-description { display: block; font-size: 12px; color: #666; white-space: pre-line; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; vertical-align: top; border-bottom: 1px solid #ddd; overflow-wrap: break-word; word-break: break-word; }
        th { background-color: {{secondaryColor}}; font-weight: bold; color: {{tableTextColor}}; }
        .items-table { table-layout: fixed; }
        .items-table th:nth-child(1), .items-table td:nth-child(1) { width: 38%; }
        .items-table th:nth-child(2), .items-table td:nth-child(2) { width: 10%; }
        .items-table th:nth-child(3), .items-table td:nth-child(3) { width: 9%; }
        .items-table th:nth-child(4), .items-table td:nth-child(4) { width: 16%; }
        .items-table th:nth-child(5), .items-table td:nth-child(5) { width: 9%; }
        .items-table th:nth-child(6), .items-table td:nth-child(6) { width: 18%; }
        .total-row { font-weight: bold; background-color: {{secondaryColor}}; color: {{tableTextColor}}; }
        .totals-table { width: 100%; border-collapse: collapse; margin: 0 0 20px; page-break-inside: avoid; break-inside: avoid; }
        .totals-table td:last-child { text-align: right; }
        .notes { margin-top: 20px; padding: 20px; background-color: {{secondaryColor}}; border-radius: 4px; color: {{tableTextColor}}; page-break-inside: avoid; break-inside: avoid; }
        .notes-content h1, .notes-content h2, .notes-content h3, .notes-content h4 { margin: 12px 0 6px; line-height: 1.3; }
        .notes-content h1:first-child, .notes-content h2:first-child, .notes-content h3:first-child, .notes-content h4:first-child { margin-top: 0; }
        .notes-content p { margin: 0 0 8px; }
        .notes-content p:last-child { margin-bottom: 0; }
        .notes-content ul, .notes-content ol { margin: 0 0 8px; padding-left: 20px; }
        .notes-content li { margin: 2px 0; }
        .notes-content a { color: {{primaryColor}}; text-decoration: underline; word-break: break-word; }
        .notes-content code { font-family: 'Courier New', monospace; background-color: rgba(0, 0, 0, 0.06); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
        .notes-content pre { font-family: 'Courier New', monospace; background-color: rgba(0, 0, 0, 0.06); padding: 8px; border-radius: 4px; overflow-wrap: break-word; white-space: pre-wrap; margin: 0 0 8px; }
        .notes-content pre code { background: none; padding: 0; }
        .notes-content blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid {{primaryColor}}; color: inherit; opacity: 0.85; }
        .notes-content hr { border: none; border-top: 1px solid rgba(0, 0, 0, 0.15); margin: 10px 0; }
        .payment-info { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid {{primaryColor}}; color: #333; }
        .validity { color: #dc2626; font-weight: bold; }
        .logo { max-height: 140px; margin-bottom: 10px; }
        .made-with {
            position: fixed;
            bottom: 10px;
            right: 10px;
            font-size: 9px;
            color: #999;
        }
        .watermark {
            position: fixed;
            top: 45%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 96px;
            font-weight: bold;
            color: #ff0000;
            opacity: 0.15;
            z-index: 1000;
            pointer-events: none;
            white-space: nowrap;
        }
    </style>
</head>
<body>
    {{#if isDraft}}
    <div class="watermark">{{draftLabel}}</div>
    {{/if}}
    <div class="made-with">Made with Invoicerr</div>
    <div class="header">
        <div class="company-name">
            {{#if includeLogo}}
                <img src="{{logoB64}}" alt="Logo" class="logo">
            {{/if}}
        </div>
        <div class="quote-info">
            <h2>{{labels.quote}}</h2>
            <p><strong>{{labels.quote}}:</strong> #{{number}}<br>
            <strong>{{labels.date}}</strong> {{date}}<br>
            <strong class="validity">{{labels.validUntil}}</strong> {{validUntil}}</p>
        </div>
        <div class="company-info">
            <h3 class="spacer">{{labels.quoteFor}}</h3>
            <p class="name">{{company.name}}</p>
            {{#if company.description}}<strong>{{labels.description}}</strong> {{company.description}}<br>{{/if}}
            <p>{{company.address}}<br>
            {{#if company.addressLine2}}{{company.addressLine2}}<br>{{/if}}
            {{company.city}}, {{#if company.state}}{{company.state}} {{/if}}{{company.postalCode}}<br>
            {{company.country}}<br>
            {{company.email}} | {{company.phone}}<br>
            {{#if company.legalId}}<strong>{{labels.legalId}}:</strong> {{company.legalId}}<br>{{/if}}
            {{#if company.VAT}}<strong>{{labels.VATId}}:</strong> {{company.VAT}}{{/if}}</p>
        </div>
        <div class="client-info">
            <h3>{{labels.quoteFor}}</h3>
            <p class="name">{{client.name}}</p>
            {{#if client.description}}<strong>{{labels.description}}</strong> {{client.description}}<br>{{/if}}
            <p>{{client.address}}<br>
            {{#if client.addressLine2}}{{client.addressLine2}}<br>{{/if}}
            {{client.city}}, {{#if client.state}}{{client.state}} {{/if}}{{client.postalCode}}<br>
            {{client.country}}{{#if client.email}}<br>{{client.email}}{{/if}}
            {{#if client.legalId}}<br><strong>{{labels.legalId}}:</strong> {{client.legalId}}{{/if}}
            {{#if client.VAT}}<br><strong>{{labels.VATId}}:</strong> {{client.VAT}}{{/if}}</p>
        </div>
    </div>
    <table class="items-table">
        <thead>
            <tr>
                <th>{{labels.description}}</th>
                <th>{{labels.type}}</th>
                <th>{{labels.quantity}}</th>
                <th>{{labels.unitPrice}}</th>
                <th>{{labels.vatRate}}</th>
                <th>{{labels.total}}</th>
            </tr>
        </thead>
        <tbody>
            {{#each items}}
            <tr>
                <td><strong>{{name}}</strong>{{#if description}}<span class="item-description">{{{description}}}</span>{{/if}}</td>
                <td>{{type}}</td>
                <td>{{quantity}}</td>
                <td>{{../currency}} {{unitPrice}}</td>
                <td>{{vatRate}}%</td>
                <td>{{../currency}} {{totalPrice}}</td>
            </tr>
            {{/each}}
        </tbody>
    </table>
    <table class="totals-table">
        <tbody>
            <tr>
                <td colspan="5"><strong>{{labels.subtotal}}</strong></td>
                <td><strong>{{currency}} {{subtotalBeforeDiscount}}</strong></td>
            </tr>
            {{#if hasDiscount}}
            <tr>
                <td colspan="5"><strong>{{labels.discount}} ({{discountRate}}%)</strong></td>
                <td><strong>-{{currency}} {{discountAmount}}</strong></td>
            </tr>
            {{/if}}
            <tr>
                <td colspan="5"><strong>{{labels.vat}}</strong></td>
                <td><strong>{{currency}} {{totalVAT}}</strong></td>
            </tr>
            {{#if vatExemptText}}
            <tr>
                <td></td>
                <td colspan="5" style="font-size:12px; color:#666; text-align:right;"><em>{{vatExemptText}}</em></td>
            </tr>
            {{/if}}
            <tr class="total-row">
                <td colspan="5"><strong>{{labels.grandTotal}}</strong></td>
                <td><strong>{{currency}} {{totalTTC}}</strong></td>
            </tr>
        </tbody>
    </table>

    {{#if paymentMethod}}
    <div class="payment-info">
        <strong>{{labels.paymentMethod}}</strong> {{paymentMethod}}<br>
        {{#if paymentDetails}}
        <strong>{{labels.paymentDetails}}</strong> {{{paymentDetails}}}
        {{/if}}
        {{#if paymentNote}}
        <br><em>{{paymentNote}}</em>
        {{/if}}
    </div>
    {{/if}}
    
    {{#if noteExists}}
    <div class="notes">
        <h4>{{labels.notes}}</h4>
        <div class="notes-content">{{{notes}}}</div>
    </div>
    {{/if}}
</body>
</html>
`;
