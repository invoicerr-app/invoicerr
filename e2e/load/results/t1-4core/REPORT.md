# Load test — t1-4core

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 422 | 88 | 303 ms | 7122 ms | 943 ms | 19.1 s | 3.9 vCPU | 4.9 GiB | 1078/2725 m | 587/1699 m | 48 | wait 0, drained in 0 s | none |

## Per step

**50 VUs** — 422 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1829/1880, worker 1459/1503, postgres 109/155, redis 23/24, ocr 192/367, mailpit 62/67

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 64 ms | 415 ms | 626 ms | 440 |
| dashboard | 79 ms | 385 ms | 614 ms | 440 |
| invoice_pdf | 691 ms | 7122 ms | 9177 ms | 440 |
| invoice_send | 161 ms | 943 ms | 1440 ms | 440 |
| list_clients | 47 ms | 275 ms | 504 ms | 440 |
| list_invoices | 40 ms | 303 ms | 423 ms | 440 |
| list_quotes | 41 ms | 261 ms | 501 ms | 440 |
| ocr_upload | 101 ms | 259 ms | 536 ms | 87 |
| poll_invoice | 102 ms | 329 ms | 505 ms | 3580 |
| poll_ocr | 30 ms | 75 ms | 142 ms | 13229 |
| quote_convert | 69 ms | 1916 ms | 2184 ms | 440 |
| quote_create | 76 ms | 661 ms | 1317 ms | 440 |
| session | 39 ms | 491 ms | 672 ms | 440 |

