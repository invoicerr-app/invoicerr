---
sidebar_position: 3
---

# Clients

The **Clients** page is your address book of everyone you bill. Clients are reused across quotes, invoices, and receipts, so you enter their details once.

## Actions

- **Add New** — create a client
- **Search** — find a client by name, first name, last name, or email
- **Filter** — click the **Active** or **Inactive** badge to filter the list (each shows a count)
- **View** (eye icon) — open a read-only summary
- **Edit** (pencil icon) — change a client's details
- **Client portal access** — invite this client to their own [Client Portal](client-portal.md)
- **Payment methods** - restrict which of your enabled [payment methods](billing/payment-methods.md)
  are offered to this client; see below
- **Delete** (trash icon) — remove a client (asks for confirmation)

## Creating a client

Click **Add New** and fill in the form.

**Client type** (required) — choose **Company** or **Individual**:

- **Company** — Company Name, Legal ID / SIRET (required), VAT Number (optional)
- **Individual** — First Name and Last Name (required)

**Contact**

- Contact Email (required)
- Contact Phone (optional)

**Address**

- Street Address (required), Address Line 2 (optional)
- Postal Code (required), City (required)
- State / Province (optional), Country (required)

**Other**

- Description (optional, up to 500 characters)
- Currency (optional) — overrides the company default for this client
- Document Language (optional) — overrides the company's default language for this client's PDFs
  and emails; see [Document Language](document-language.md)
- Founded Date (optional, cannot be in the future)

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
