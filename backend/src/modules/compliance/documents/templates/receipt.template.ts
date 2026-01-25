/**
 * Receipt Template
 */

import {
  baseStyles,
  notesSection,
  legalMentionsSection,
  qrCodeSection,
  qrCodeTopSection,
} from './base.template';

export const receiptTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{{labels.receipt}} #{{number}}</title>
  ${baseStyles}
  <style>
    .receipt-summary {
      background: #e8f5e9;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      border-left: 4px solid #4caf50;
    }

    .receipt-summary h4 {
      color: #2e7d32;
      margin-bottom: 10px;
      font-size: 14px;
    }

    .receipt-summary .amount {
      font-size: 24px;
      font-weight: bold;
      color: #1b5e20;
    }

    .receipt-details {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px dashed #a5d6a7;
    }

    .receipt-details p {
      font-size: 12px;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  ${qrCodeTopSection}
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
      <h2>{{labels.receipt}}</h2>
      <p><strong>{{labels.receipt}}:</strong> #{{number}}</p>
      <p><strong>{{labels.paymentDate}}</strong> {{paymentDate}}</p>
      {{#if originalInvoiceNumber}}
        <p><strong>{{labels.originalInvoice}}</strong> #{{originalInvoiceNumber}}</p>
      {{/if}}
    </div>
  </div>

  <div class="parties">
    <div class="party-info">
      <h3>{{labels.receivedFrom}}</h3>
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

  <div class="receipt-summary">
    <h4>Payment Received</h4>
    <div class="amount">{{totalTTC}} {{currencySymbol}}</div>
    <div class="receipt-details">
      {{#if paymentMethod}}
        <p><strong>{{labels.paymentMethod}}</strong> {{paymentMethod}}</p>
      {{/if}}
      {{#if paymentDetails}}
        <p>{{paymentDetails}}</p>
      {{/if}}
    </div>
  </div>

  {{#if items.length}}
    <table>
      <thead>
        <tr>
          <th>{{labels.description}}</th>
          <th>{{labels.total}}</th>
        </tr>
      </thead>
      <tbody>
        {{#each items}}
        <tr>
          <td>{{description}}</td>
          <td>{{totalPrice}} {{../currencySymbol}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  {{/if}}

  ${notesSection}

  ${legalMentionsSection}

  ${qrCodeSection}

</body>
</html>
`;
