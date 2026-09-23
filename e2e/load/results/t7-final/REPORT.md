# Load test — t7-final

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 434 | 91 | 254 ms | 5683 ms | 596 ms | 17.8 s | 4.8 vCPU | 6.3 GiB | 1166/2666 m | 691/1856 m | 49 | wait 0, drained in 0 s | none |

## Per step

**50 VUs** — 434 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1831/1886, worker 1584/1630, postgres 85/138, redis 12/16, ocr 123/240, mailpit 39/42

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 51 ms | 437 ms | 611 ms | 453 |
| dashboard | 64 ms | 367 ms | 523 ms | 453 |
| invoice_pdf | 603 ms | 5683 ms | 8691 ms | 453 |
| invoice_send | 115 ms | 596 ms | 1010 ms | 453 |
| list_clients | 40 ms | 254 ms | 372 ms | 453 |
| list_invoices | 38 ms | 230 ms | 297 ms | 453 |
| list_quotes | 38 ms | 215 ms | 299 ms | 453 |
| ocr_upload | 388 ms | 848 ms | 938 ms | 90 |
| poll_invoice | 62 ms | 208 ms | 308 ms | 3576 |
| poll_ocr | 36 ms | 81 ms | 132 ms | 13556 |
| quote_convert | 55 ms | 1221 ms | 1516 ms | 453 |
| quote_create | 59 ms | 550 ms | 1022 ms | 453 |
| session | 35 ms | 405 ms | 468 ms | 453 |

