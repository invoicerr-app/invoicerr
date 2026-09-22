---
sidebar_position: 2
sidebar_label: "🇵🇱 KSeF"
---

# KSeF Setup Guide

**KSeF** (Krajowy System e-Faktur) is the Polish mandatory national e-invoicing system. It requires all invoices issued in Poland to be transmitted and stored electronically through the government-run platform.

Follow the steps below to obtain the credentials needed to connect Invoicerr to KSeF.

---

## 1. Obtain your NIP number

Your company must have a Polish **NIP** (Numer Identyfikacji Podatkowej) tax identification number.

- If you are already registered for tax purposes in Poland, your NIP is your tax ID.
- If you are a foreign company, you may need to register for a Polish NIP through your local tax office or appoint a Polish fiscal representative.

---

## 2. Obtain KSeF access tokens via the Ministry API

KSeF uses an **API-based authentication** model. To send invoices you need:

- **NIP** — your Polish tax ID
- **Invoice token** or **authorisation certificate** (depending on the integration method)

### Get a KSeF token

Invoicerr's own KSeF channel only ever authenticates with a **token** — its connection form has no
certificate upload at all, so a qualified electronic signature / authorisation certificate (an
option KSeF itself offers for other integrations) is not something you can use here.

1. Log in to the Polish e-Tax portal ([podatki.gov.pl](https://podatki.gov.pl)).
2. Navigate to **KSeF → Token management**.
3. Generate a new **API token** for invoice submission.
4. Set the appropriate permissions (at minimum: `invoice:send`, `invoice:read`).
5. Copy and store the token securely.

---

## 3. Configure the KSeF environment

KSeF has two environments:

| Environment | URL | Purpose |
|-------------|-----|---------|
| **Test** | `https://ksef-test.mf.gov.pl` | Development and testing |
| **Production** | `https://ksef.mf.gov.pl` | Live invoice submission |

Start with the **Test** environment, validate your integration, then switch to **Production**.

---

## 4. Connect Invoicerr to KSeF

Once you have your credentials, configure the KSeF channel in Invoicerr:

1. Go to **Settings → E-invoicing → Channels**.
2. Click **Connect** on the KSeF card.
3. Fill in the two fields this channel actually asks for:
   - **NIP** — your Polish tax ID
   - **KSeF token** — the API token from step 2 above
   - **Environment** — `TEST` or `PRODUCTION` (the same selector every channel offers)
4. Save the configuration.

Invoicerr will use these credentials to authenticate with the KSeF API and transmit invoices on your behalf.

---

## Additional resources

- [KSeF official documentation (Polish)](https://www.podatki.gov.pl/ksef)
- [KSeF API specification](https://ksef-test.mf.gov.pl/api)
