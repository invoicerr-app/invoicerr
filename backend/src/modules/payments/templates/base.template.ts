export const baseTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{labels.receipt}} {{number}}</title>
  <style>
        body { font-family: {{fontFamily}}, sans-serif; margin: {{padding}}px; color: #333; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company-info h1 { margin: 0; color: {{primaryColor}}; }
        .receipt-info { text-align: right; }
        .client-info { margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: {{secondaryColor}}; font-weight: bold; color: {{tableTextColor}}; }        
        .total-row { font-weight: bold; background-color: {{secondaryColor}}; color: {{tableTextColor}}; }
        .logo { max-height: 80px; margin-bottom: 10px; }
  </style>
</head>
<body>
    <div class="header">
        <div class="company-info">
            {{#if includeLogo}}
            <img src="{{logoB64}}" alt="Logo" class="logo">
            {{/if}}
            <h1>{{company.name}}</h1><br>
            {{#if company.description}}<strong>{{labels.description}}</strong> {{company.description}}<br>{{/if}}
            <p>{{company.address}}<br>
            {{#if company.addressLine2}}{{company.addressLine2}}<br>{{/if}}
            {{company.city}}, {{#if company.state}}{{company.state}} {{/if}}{{company.postalCode}}<br>
            {{company.country}}<br>
            {{company.email}} | {{company.phone}}<br>
            {{#if company.legalId}}<strong>{{labels.legalId}}:</strong> {{company.legalId}}<br>{{/if}}
            {{#if company.VAT}}<strong>{{labels.VATId}}:</strong> {{company.VAT}}{{/if}}</p>
        </div>
        <div class="receipt-info">
            <h2>{{labels.receipt}}</h2>
            <p><strong>{{labels.receipt}}:</strong> #{{number}}<br>
            <strong>{{labels.paymentDate}}</strong> {{paymentDate}}<br>
            <strong>{{labels.invoiceRefer}}</strong> #{{invoiceNumber}}</p>
        </div>
    </div>
    <div class="client-info">
        <h3>{{labels.receivedFrom}}</h3>
        <p>{{client.name}}<br>
        {{#if client.description}}<strong>{{labels.description}}</strong> {{client.description}}<br>{{/if}}
        {{client.address}}<br>
        {{#if client.addressLine2}}{{client.addressLine2}}<br>{{/if}}
        {{client.city}}, {{#if client.state}}{{client.state}} {{/if}}{{client.postalCode}}<br>
        {{client.country}}<br>
        {{client.email}}</p>
        {{#if client.legalId}}<strong>{{labels.legalId}}:</strong> {{client.legalId}}<br>{{/if}}
        {{#if client.VAT}}<strong>{{labels.VATId}}:</strong> {{client.VAT}}{{/if}}</p>
    </div>



  <table>
    <thead><tr><th>{{labels.description}}</th><th>{{labels.type}}</th><th>{{labels.totalReceived}}</th></tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td>{{description}}</td>
        <td>{{type}}</td>
        <td>{{currency}} {{amount}}</td>
      </tr>
    {{/each}}
    <tr>
      <td><strong>{{labels.total}}</strong></td>
      <td></td>
      <td><strong>{{currency}} {{totalBeforeDiscount}}</strong></td>
    </tr>
    {{#if hasDiscount}}
    <tr>
      <td><strong>{{labels.discount}} ({{discountRate}}%)</strong></td>
      <td></td>
      <td><strong>-{{currency}} {{discountAmount}}</strong></td>
    </tr>
    {{/if}}
    <tr class="total-row">
      <td><strong>{{labels.totalReceived}}</strong></td>
      <td></td>
      <td><strong>{{currency}} {{totalAmount}}</strong></td>
    </tr>
    </tbody>
  </table>
  
    {{#if paymentMethod}}
    <div class="payment-info">
        <strong>{{labels.paymentMethod}}</strong> {{paymentMethod}}<br>
        {{#if paymentDetails}}
        <strong>{{labels.paymentDetails}}</strong> {{{paymentDetails}}}
        {{/if}}
    </div>
    {{/if}}
</body>
</html>
`;
