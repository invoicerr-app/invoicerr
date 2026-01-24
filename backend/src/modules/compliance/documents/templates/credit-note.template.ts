/**
 * Credit Note Template
 */

import {
  baseStyles,
  itemsTable,
  totalsSection,
  notesSection,
  legalMentionsSection,
} from './base.template';

export const creditNoteTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{{labels.creditNote}} #{{number}}</title>
  ${baseStyles}
  <style>
    .document-info h2 {
      color: #dc3545 !important;
    }

    .totals-table tr:last-child {
      background: #dc3545 !important;
    }

    thead {
      background: #6c757d !important;
    }
  </style>
</head>
<body>
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
      <h2>{{labels.creditNote}}</h2>
      <p><strong>{{labels.creditNote}}:</strong> #{{number}}</p>
      <p><strong>{{labels.date}}</strong> {{date}}</p>
    </div>
  </div>

  <div class="credit-note-info">
    <h4>{{labels.originalInvoice}} #{{originalInvoiceNumber}}</h4>
    {{#if correctionReason}}
      <p><strong>{{labels.correctionReason}}</strong> {{correctionReason}}</p>
    {{/if}}
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

  ${notesSection}

  ${legalMentionsSection}

</body>
</html>
`;
