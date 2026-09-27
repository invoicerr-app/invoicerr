# Load test — t5-ocr-pool

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 576 | 118 | 172 ms | 3467 ms | 615 ms | 10.8 s | 6.2 vCPU | 4.6 GiB | 1402/3131 m | 790/2290 m | 46 | wait 0, drained in 0 s | 5/24483 checks |

## Per step

**50 VUs** — 576 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1723/1765, worker 1560/1636, postgres 86/138, redis 11/15, ocr 143/239, mailpit 64/70

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 39 ms | 291 ms | 429 ms | 590 |
| dashboard | 53 ms | 251 ms | 327 ms | 590 |
| invoice_pdf | 463 ms | 3467 ms | 6470 ms | 590 |
| invoice_send | 79 ms | 615 ms | 820 ms | 590 |
| list_clients | 34 ms | 172 ms | 226 ms | 590 |
| list_invoices | 33 ms | 137 ms | 198 ms | 590 |
| list_quotes | 34 ms | 122 ms | 167 ms | 590 |
| ocr_upload | 100 ms | 155 ms | 219 ms | 117 |
| poll_invoice | 51 ms | 159 ms | 235 ms | 2491 |
| poll_ocr | 27 ms | 46 ms | 68 ms | 14692 |
| quote_convert | 48 ms | 214 ms | 308 ms | 590 |
| quote_create | 50 ms | 325 ms | 422 ms | 590 |
| session | 29 ms | 280 ms | 429 ms | 590 |

