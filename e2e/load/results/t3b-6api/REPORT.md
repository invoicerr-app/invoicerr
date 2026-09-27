# Load test — t3b-6api

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 521 | 107 | 185 ms | 4431 ms | 605 ms | 9987 ms | 5.8 vCPU | 6.6 GiB | 1603/4896 m | 706/2334 m | 76 | wait 0, drained in 0 s | none |

## Per step

**50 VUs** — 521 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 3494/3739, worker 1488/1520, postgres 114/204, redis 19/20, ocr 163/316, mailpit 78/83

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 42 ms | 284 ms | 522 ms | 536 |
| dashboard | 58 ms | 377 ms | 564 ms | 536 |
| invoice_pdf | 459 ms | 4431 ms | 5531 ms | 536 |
| invoice_send | 88 ms | 605 ms | 1260 ms | 536 |
| list_clients | 35 ms | 169 ms | 253 ms | 536 |
| list_invoices | 37 ms | 159 ms | 228 ms | 536 |
| list_quotes | 45 ms | 185 ms | 317 ms | 536 |
| ocr_upload | 99 ms | 170 ms | 221 ms | 106 |
| poll_invoice | 53 ms | 157 ms | 231 ms | 2286 |
| poll_ocr | 26 ms | 51 ms | 86 ms | 14914 |
| quote_convert | 49 ms | 322 ms | 678 ms | 536 |
| quote_create | 53 ms | 311 ms | 814 ms | 536 |
| session | 28 ms | 490 ms | 748 ms | 536 |

