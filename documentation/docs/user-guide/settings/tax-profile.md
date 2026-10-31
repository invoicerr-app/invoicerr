---
sidebar_position: 5
---

# Tax profile

**Settings > Company > Company profile** asks the questions your country's tax rules depend on and
that only you can answer, such as the size category a French seller falls into. The section appears
only for a country that declares such questions, and each question disappears once it stops
applying.

A question you have not answered yet leaves your company in the strictest case the country defines.
Answering it once is enough for Invoicerr to apply the matching rules afterwards.

## What each country asks

| Country | Question | Why it matters |
| --- | --- | --- |
| France | Company size category | The date from which an invoice must be issued through an accredited platform depends on it. |
| France | VAT regime | Shown from your VAT exemption switch, not asked: the franchise in base is the exempt scheme. |
| France | Option for VAT on debits | Asked only under the normal regime, since only a company that charges VAT can opt to pay it on debits. |
| Germany | Recapitulative statement period | Monthly by default; quarterly below the turnover threshold set by the law, yearly for a company exempted from advance returns. |
| Italy | Tax regime | The regime the electronic invoice carries, as the tax authority enumerates it. |
| Poland | Intra-EU VAT registration | Whether your company is entered in the VAT UE register an intra-Community supply requires. |
| Algeria | Tax regime | The regime under which your company is taxed on its turnover. |

Portugal declares no question here, so a Portuguese company sees no Company profile section.

## The VAT regime row

The VAT regime is not a field you fill in. It follows the **VAT exempt** switch on the same page: on
means the franchise in base, off means the normal regime. The row shows the value and stays locked;
change the switch to change it.

## Changing country

The questions belong to the country your company is established in. When you change that country,
Invoicerr keeps only the answers the new country asks for and drops the others; the questions of the
new country appear the next time the page loads.
