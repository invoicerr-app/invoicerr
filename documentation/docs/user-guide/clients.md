---
sidebar_position: 3
---

# Clients

The **Clients** page is your address book of everyone you bill. Clients are reused across quotes and invoices, so you enter their details once. Each client is a row with its initials, its name, and its email, phone and city underneath.

## Actions

- **Add New**: create a client
- **Search**: find a client by name, first name, last name, or email
- **Filter**: pick **All**, **Active**, **Inactive** or **Suppliers** in the segmented control above the list (each shows a count)
- **View** (eye icon): open a read-only summary
- **Edit** (pencil icon): change a client's details
- **Client portal access**: invite this client to their own [Client Portal](client-portal.md)
- **Payment methods** - restrict which of your enabled [payment methods](billing/payment-methods.md)
  are offered to this client; see below
- **Delete** (trash icon): remove a client (asks for confirmation)

## Creating a client

Click **Add New**. The form shows every section on one page: **Identity**, **Address**,
**Tax & identifiers**, **Contact & portal** and **Summary**. Everything is checked when you save; if
a field needs attention, the form scrolls to it and says what is wrong. Closing a form you have
changed asks before discarding it.

### What is required

| To save a client | Required |
| --- | --- |
| **Company** | Company name |
| **Individual** | First name and last name |
| Any client | Country, street address and city |
| Any client | The identifiers the client's country marks as required for its type |

Everything else is optional, including the postal code, the email and the phone number.

### Identity

- **Client type**: **Company** or **Individual**
- **Company name**, or **First name** and **Last name** for an individual
- **Description** (up to 500 characters)
- **Founded date**: the official registration date of the company. It is filled automatically by the
  company lookup when you use it, and it cannot be in the future
- **Supplier**: turn it on if this company is also one of your suppliers

### Address

**Country** (it drives the identifiers and the currency suggested in the next section), **Address**,
**Address line 2**, **Postal code**, **City** and **State / Province**. If address suggestions are
enabled on your instance, picking one fills the whole block.

### Tax & identifiers

- **Client kind**: **Business** or **Government**. A government client is sent through the channel
  its country requires for public buyers
- **Currency**: overrides your company's default currency for this client
- **Country-specific identifiers**: the identifiers your client's country asks for (for example a
  SIREN or SIRET in France, a NIF in Portugal). The ones marked as required must be filled in to save
  the client from this form. What is required depends on the client type: a French SIREN, a
  Portuguese NIF, an Italian Partita IVA or a Polish NIP is required of a company, while an
  individual may leave it empty (a private person in France has no SIREN, and a Portuguese private
  client's NIF goes on the invoice only when they ask for it). An Italian individual must give a
  codice fiscale instead. A client saved before its country required one of these keeps its record,
  and the form asks for the missing identifier the next time you edit it. Every identifier you fill
  in is printed on the client's documents. Where
  your instance supports it, **Look up** fills the client's name, address and founded date from the
  official business registry
- **Peppol**: an optional electronic routing address

### Contact & portal

One or several contacts, each with a name, role, email and phone, and one marked as the primary
contact. The **Document language** overrides your company's default language for this client's PDFs
and emails; see [Document Language](document-language.md). Once the client exists, this section also
gives access to the [Client Portal](client-portal.md) invitation.

If a client with the same email, or the same name in the same country, already exists, a warning
names it and links to it. You can still create the client.

## Creating a client from a quote or an invoice

The **Client** field of a [quote](billing/quotes.md) or an [invoice](billing/invoices.md) ends with a
**Create new client** option. It opens a short form instead of the full one: the client type, the
name (or first and last name) and the country, which starts as your own company's country and can be
changed. Saving creates the client and selects it on the document straight away, without losing
anything you already entered.

**Fill in all the details** switches to the full form, keeping what you typed.

A client created this way has no address yet. That is fine for a quote, but an invoice cannot be
issued without it, see below.

## Completing a client before invoicing

**Validate** and **Send** on an [invoice](billing/invoices.md) are refused when the client lacks what
an issued invoice needs:

- the street address and the city
- an identifier your own country's invoicing law requires of this client on this invoice

The message names what is missing and offers an **Edit client** button that opens the client's edit
form. Nothing is lost: complete the client, come back to the invoice, and run the action again. A draft
can always be saved, and a quote can always be sent, whatever the state of the client.

:::info[Why the identifiers]
The identifiers checked here come from your own country's invoicing law, and depend on the client's
type and country: a French company issuing to a French business client needs its SIREN, but never
asks a private client for one. They can differ from what the form asks for, which follows the
client's own country. For example, the VAT number of a business client in another EU country is not
required to save the client, yet a French invoice to it must carry it. The draft's PDF marks each
missing one, see [Identifiers on the PDF](billing/invoices.md#identifiers-on-the-pdf).
:::

Picking a country fills in **Currency** with that country's usual currency, and, for a new client,
suggests a **Document Language** when the country has one clear choice. Both are only starting
points: change either one freely. Editing an existing client never changes its currency or language
on its own; only picking a different country fills in the currency again.

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
