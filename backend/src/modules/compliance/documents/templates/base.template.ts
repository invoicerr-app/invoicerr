/**
 * Base Template
 * Common styles and sections used across all document types
 */

/**
 * Common CSS styles for all documents
 */
export const baseStyles = `
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: {{fontFamily}}, sans-serif;
    font-size: 12px;
    line-height: 1.5;
    color: #333;
    padding: {{padding}}px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 40px;
  }

  .company-info {
    max-width: 50%;
  }

  .company-info h1 {
    font-size: 24px;
    color: {{primaryColor}};
    margin-bottom: 10px;
  }

  .company-info p {
    color: #666;
    font-size: 11px;
  }

  .document-info {
    text-align: right;
    max-width: 40%;
  }

  .document-info h2 {
    font-size: 20px;
    color: {{primaryColor}};
    margin-bottom: 10px;
  }

  .document-info p {
    font-size: 11px;
    margin-bottom: 3px;
  }

  .logo {
    max-width: 150px;
    max-height: 80px;
    margin-bottom: 15px;
  }

  .parties {
    display: flex;
    justify-content: space-between;
    margin-bottom: 30px;
  }

  .party-info {
    width: 45%;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
  }

  .party-info h3 {
    font-size: 12px;
    color: {{secondaryColor}};
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
    border-bottom: 2px solid {{primaryColor}};
    padding-bottom: 5px;
  }

  .party-info p {
    font-size: 11px;
    line-height: 1.6;
  }

  .identifiers {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed #ddd;
    font-size: 10px;
  }

  .identifiers strong {
    text-transform: uppercase;
    color: {{secondaryColor}};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 30px;
  }

  thead {
    background: {{secondaryColor}};
    color: {{tableTextColor}};
  }

  th {
    padding: 12px 10px;
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  th:last-child,
  td:last-child {
    text-align: right;
  }

  td {
    padding: 12px 10px;
    border-bottom: 1px solid #eee;
    font-size: 11px;
  }

  tbody tr:hover {
    background: #f8f9fa;
  }

  .totals {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 30px;
  }

  .totals-table {
    width: 300px;
  }

  .totals-table table {
    margin-bottom: 0;
  }

  .totals-table td {
    padding: 8px 10px;
    border: none;
  }

  .totals-table tr:last-child {
    font-weight: bold;
    font-size: 14px;
    background: {{primaryColor}};
    color: white;
  }

  .totals-table tr:last-child td {
    padding: 12px 10px;
  }

  .vat-breakdown {
    margin-bottom: 20px;
  }

  .vat-breakdown h4 {
    font-size: 11px;
    color: {{secondaryColor}};
    margin-bottom: 8px;
  }

  .vat-breakdown table {
    width: 300px;
    font-size: 10px;
  }

  .vat-breakdown td {
    padding: 5px 8px;
  }

  .notes {
    margin-bottom: 20px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    border-left: 4px solid {{primaryColor}};
  }

  .notes h4 {
    font-size: 11px;
    color: {{secondaryColor}};
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .notes p {
    font-size: 11px;
    color: #666;
    white-space: pre-wrap;
  }

  .payment-info {
    margin-bottom: 20px;
    padding: 15px;
    background: #e8f4fd;
    border-radius: 8px;
  }

  .payment-info h4 {
    font-size: 11px;
    color: {{primaryColor}};
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .payment-info p {
    font-size: 11px;
  }

  .legal-mentions {
    margin-top: 30px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    font-size: 9px;
    color: #888;
  }

  .legal-mentions p {
    margin-bottom: 5px;
  }

  .vat-exempt {
    background: #fff3cd;
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 15px;
    font-size: 11px;
    color: #856404;
  }

  .qr-code {
    text-align: right;
    margin-top: 20px;
  }

  .qr-code img {
    width: 100px;
    height: 100px;
  }

  .footer {
    position: fixed;
    bottom: {{padding}}px;
    left: {{padding}}px;
    right: {{padding}}px;
    text-align: center;
    font-size: 9px;
    color: #aaa;
    border-top: 1px solid #eee;
    padding-top: 10px;
  }

  /* Credit note specific */
  .credit-note-info {
    background: #f8d7da;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
    border-left: 4px solid #dc3545;
  }

  .credit-note-info h4 {
    color: #721c24;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .credit-note-info p {
    font-size: 11px;
    color: #721c24;
  }

  /* Quote validity highlight */
  .validity-highlight {
    color: {{primaryColor}};
    font-weight: bold;
  }

  @media print {
    body {
      padding: 0;
    }
    .footer {
      position: relative;
    }
  }
</style>
`;

/**
 * Header section template
 */
export const headerSection = `
<div class="header">
  <div class="company-info">
    {{#if includeLogo}}
      {{#if logoB64}}
        <img src="{{logoB64}}" alt="Logo" class="logo">
      {{/if}}
    {{/if}}
    <h1>{{company.name}}</h1>
    {{#if company.description}}
      <p>{{company.description}}</p>
    {{/if}}
    <p>
      {{company.address}}<br>
      {{company.postalCode}} {{company.city}}<br>
      {{company.country}}<br>
      {{#if company.email}}{{company.email}}{{/if}}
      {{#if company.phone}} | {{company.phone}}{{/if}}
    </p>
    {{#if company.identifiers}}
      <div class="identifiers">
        {{#each company.identifiers}}
          <strong>{{@key}}:</strong> {{this}}<br>
        {{/each}}
      </div>
    {{/if}}
  </div>
  <div class="document-info">
    {{> documentInfo}}
  </div>
</div>
`;

/**
 * Client section template
 */
export const clientSection = `
<div class="parties">
  <div class="party-info">
    <h3>{{clientLabel}}</h3>
    <p>
      <strong>{{client.name}}</strong><br>
      {{client.address}}<br>
      {{client.postalCode}} {{client.city}}<br>
      {{client.country}}<br>
      {{#if client.email}}{{client.email}}{{/if}}
    </p>
    {{#if client.identifiers}}
      <div class="identifiers">
        {{#each client.identifiers}}
          <strong>{{@key}}:</strong> {{this}}<br>
        {{/each}}
      </div>
    {{/if}}
  </div>
</div>
`;

/**
 * Items table template
 */
export const itemsTable = `
<table>
  <thead>
    <tr>
      <th>{{labels.description}}</th>
      <th>{{labels.quantity}}</th>
      <th>{{labels.unitPrice}}</th>
      <th>{{labels.vatRate}}</th>
      <th>{{labels.total}}</th>
    </tr>
  </thead>
  <tbody>
    {{#each items}}
    <tr>
      <td>{{description}}</td>
      <td>{{quantity}}</td>
      <td>{{unitPrice}} {{../currencySymbol}}</td>
      <td>{{vatRate}}%</td>
      <td>{{totalPrice}} {{../currencySymbol}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
`;

/**
 * Totals section template
 */
export const totalsSection = `
{{#if vatExemptText}}
  <div class="vat-exempt">
    {{vatExemptText}}
  </div>
{{/if}}

{{#if vatBreakdown}}
  <div class="vat-breakdown">
    <h4>{{labels.vat}} Breakdown</h4>
    <table>
      {{#each vatBreakdown}}
      <tr>
        <td>{{rate}}%</td>
        <td>{{baseAmount}} {{../currencySymbol}}</td>
        <td>{{vatAmount}} {{../currencySymbol}}</td>
      </tr>
      {{/each}}
    </table>
  </div>
{{/if}}

<div class="totals">
  <div class="totals-table">
    <table>
      <tr>
        <td>{{labels.subtotal}}</td>
        <td>{{totalHT}} {{currencySymbol}}</td>
      </tr>
      <tr>
        <td>{{labels.vat}}</td>
        <td>{{totalVAT}} {{currencySymbol}}</td>
      </tr>
      <tr>
        <td>{{labels.grandTotal}}</td>
        <td>{{totalTTC}} {{currencySymbol}}</td>
      </tr>
    </table>
  </div>
</div>
`;

/**
 * Payment info section template
 */
export const paymentSection = `
{{#if paymentMethod}}
  <div class="payment-info">
    <h4>{{labels.paymentMethod}}</h4>
    <p><strong>{{paymentMethod}}</strong></p>
    {{#if paymentDetails}}
      <p>{{paymentDetails}}</p>
    {{/if}}
  </div>
{{/if}}
`;

/**
 * Notes section template
 */
export const notesSection = `
{{#if notes}}
  <div class="notes">
    <h4>{{labels.notes}}</h4>
    <p>{{notes}}</p>
  </div>
{{/if}}
`;

/**
 * Legal mentions section template
 */
export const legalMentionsSection = `
{{#if legalMentions}}
  <div class="legal-mentions">
    {{#each legalMentions}}
      <p>{{this}}</p>
    {{/each}}
  </div>
{{/if}}
`;

/**
 * QR Code section template
 */
export const qrCodeSection = `
{{#if qrCode}}
  <div class="qr-code">
    <img src="{{qrCode}}" alt="QR Code">
  </div>
{{/if}}
`;
