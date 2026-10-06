---
sidebar_position: 3
---

# Clients

The **Clients** page is your address book of everyone you bill. Clients are reused across quotes, invoices, and receipts, so you enter their details once.

## Actions

- **Add New**: create a client
- **Search**: find a client by name, first name, last name, or email
- **Filter**: click the **Active** or **Inactive** badge to filter the list (each shows a count)
- **View** (eye icon): open a read-only summary
- **Edit** (pencil icon): change a client's details
- **Client portal access**: invite this client to their own [Client Portal](client-portal.md)
- **Payment methods** - restrict which of your enabled [payment methods](billing/payment-methods.md)
  are offered to this client; see below
- **Delete** (trash icon): remove a client (asks for confirmation)

## Creating a client

Click **Add New**. The form is a short wizard with five steps: **Identity**, **Address**,
**Tax & identifiers**, **Contact & portal** and **Summary**. Each step is checked when you continue,
and you can go back at any time without losing what you typed.

### What is required

| To save a client | Required |
| --- | --- |
| **Company** | Company name |
| **Individual** | First name and last name |
| Any client | Country, street address and city |
| Any client | The identifiers marked as required for the client's country |

Everything else is optional, including the postal code, the email and the phone number.

### Identity

- **Client type**: **Company** or **Individual**
- **Company name**, or **First name** and **Last name** for an individual
- **Description** (up to 500 characters)
- **Founded date**: the official registration date of the company. It is filled automatically by the
  company lookup when you use it, and it cannot be in the future
- **Supplier**: turn it on if this company is also one of your suppliers

### Address

**Country** (it drives the identifiers and the currency suggested on the next step), **Address**,
**Address line 2**, **Postal code**, **City** and **State / Province**. If address suggestions are
enabled on your instance, picking one fills the whole block.

### Tax & identifiers

- **Client kind**: **Business** or **Government**. A government client is sent through the channel
  its country requires for public buyers
- **Currency**: overrides your company's default currency for this client
- **Country-specific identifiers**: the identifiers your client's country asks for (for example a
  SIREN or SIRET in France, a NIF in Portugal). The ones marked as required must be filled in to save
  the client from this wizard. Where your instance supports it, **Look up** fills the client's name,
  address and founded date from the official business registry
- **Peppol**: an optional electronic routing address

### Contact & portal

One or several contacts, each with a name, role, email and phone, and one marked as the primary
contact. The **Document language** overrides your company's default language for this client's PDFs
and emails; see [Document Language](document-language.md). Once the client exists, this step also
gives access to the [Client Portal](client-portal.md) invitation.

If a client with the same email, or the same name in the same country, already exists, a warning
names it and links to it. You can still create the client.

## Creating a client from a quote or an invoice

The **Client** field of a [quote](billing/quotes.md) or an [invoice](billing/invoices.md) ends with a
**Create new client** option. It opens a one-screen form instead of the wizard: the client type, the
name (or first and last name) and the country, which starts as your own company's country and can be
changed. Saving creates the client and selects it on the document straight away, without losing
anything you already entered.

**Fill in all the details** switches to the full wizard, keeping what you typed.

A client created this way has no address yet. That is fine for a quote, but an invoice cannot be
issued without it, see below.

## Completing a client before invoicing

**Validate** and **Send** on an [invoice](billing/invoices.md) are refused when the client lacks what
an issued invoice needs:

- the street address and the city
- every identifier marked as required for the client's country

The message names what is missing and offers an **Edit client** button that opens the client's edit
form. Nothing is lost: complete the client, come back to the invoice, and run the action again. A draft
can always be saved, and a quote can always be sent, whatever the state of the client.

:::info[Why the identifiers]
Which identifiers an invoice must carry depends on the buyer's country, and the list is the same one
the wizard marks as required. A client from a country with no required identifier only needs an
address and a city.
:::

## Restricting payment methods for a client

By default, a client is offered every [payment method](billing/payment-methods.md) your company
has enabled - nothing to set up, this is how every client already behaves.

To narrow it down for one client, open **Payment methods** from that client's row menu (or from
its **View** screen). Turn on **Restrict payment methods**, then check only the methods you want
to offer this client - for example a client who insists on bank transfer only, or a foreign client
for whom a card payment is the only realistic option.

:::info[What this does and doesn't change]
- The restriction only **narrows**: it can never offer a method your company hasn't itself
  enabled. If you later disable a method the client was restricted to, it simply disappears for
 them too - nothing to undo on the client's own side.
- It applies everywhere a payment method is shown to this client: the invoice PDF's own "Payment
  methods" section, the covering email, and the [Client Portal](client-portal.md)'s online payment
  link.
- Turning the restriction off (or leaving it off) returns to the default: every enabled method,
  exactly as before.
:::

## Statuses

| Status | Meaning |
| --- | --- |
| **Active** | Available when creating quotes and invoices |
| **Inactive** | Archived, kept for history |

## First use

When you have no clients yet, the page shows a *"No clients yet"* message with an **Add New** button. Add your first client here, then head to [Payment Methods](billing/payment-methods.md).
