# Load test — t3a-1api-conc12-3gi

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 231 | 0 | 798 ms | 10.8 s | 637 ms | — | 5.8 vCPU | 3.7 GiB | 948/2497 m | 1164/3324 m | 27 | wait 0, drained in 1 s | 297/20407 checks |

## Per step

**50 VUs** — 231 loops, 250 failed sends, 0 timed out; memory avg/peak MiB: api 818/931, worker 1432/1542, postgres 70/97, redis 11/12, ocr 170/241, mailpit 44/49

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 90 ms | 1400 ms | 1431 ms | 250 |
| dashboard | 123 ms | 1284 ms | 1835 ms | 250 |
| invoice_pdf | 841 ms | 10.8 s | 13.1 s | 250 |
| invoice_send | 254 ms | 637 ms | 732 ms | 250 |
| list_clients | 74 ms | 798 ms | 868 ms | 250 |
| list_invoices | 65 ms | 522 ms | 685 ms | 250 |
| list_quotes | 68 ms | 400 ms | 505 ms | 250 |
| ocr_upload | 93 ms | 142 ms | 162 ms | 50 |
| poll_invoice | 75 ms | 221 ms | 311 ms | 5566 |
| poll_ocr | 27 ms | 41 ms | 61 ms | 11760 |
| quote_convert | 104 ms | 732 ms | 818 ms | 250 |
| quote_create | 107 ms | 1381 ms | 1461 ms | 250 |
| session | 60 ms | 221 ms | 282 ms | 250 |

