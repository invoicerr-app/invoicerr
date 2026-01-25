/**
 * Invoice Template
 */

import {
  baseStyles,
  itemsTable,
  totalsSection,
  paymentSection,
  notesSection,
  legalMentionsSection,
  qrCodeSection,
  qrCodeTopSection,
} from './base.template';

export const invoiceTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{{labels.invoice}} #{{number}}</title>
  ${baseStyles}
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
      <h2>{{labels.invoice}}</h2>
      <p><strong>{{labels.invoice}}:</strong> #{{number}}</p>
      <p><strong>{{labels.date}}</strong> {{date}}</p>
      <p><strong>{{labels.dueDate}}</strong> {{dueDate}}</p>
    </div>
  </div>

  <div class="parties">
    <div class="party-info">
      <h3>{{labels.billTo}}</h3>
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

  ${itemsTable}

  ${totalsSection}

  ${paymentSection}

  ${notesSection}

  ${legalMentionsSection}

  ${qrCodeSection}

</body>
</html>
`;
