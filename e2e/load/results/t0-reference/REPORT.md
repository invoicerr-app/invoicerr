# Load test — t0-reference

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 505 | 104 | 195 ms | 3913 ms | 530 ms | 12.0 s | 5.6 vCPU | 4.6 GiB | 1316/3075 m | 737/2276 m | 41 | wait 0, drained in 0 s | none |

## Per step

**50 VUs** — 505 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1753/1874, worker 1528/1589, postgres 102/156, redis 18/19, ocr 99/246, mailpit 78/86

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 47 ms | 276 ms | 442 ms | 522 |
| dashboard | 61 ms | 277 ms | 367 ms | 522 |
| invoice_pdf | 490 ms | 3913 ms | 6708 ms | 522 |
| invoice_send | 101 ms | 530 ms | 945 ms | 522 |
| list_clients | 38 ms | 195 ms | 302 ms | 522 |
| list_invoices | 36 ms | 151 ms | 178 ms | 522 |
| list_quotes | 36 ms | 153 ms | 201 ms | 522 |
| ocr_upload | 116 ms | 220 ms | 255 ms | 104 |
| poll_invoice | 65 ms | 187 ms | 270 ms | 2701 |
| poll_ocr | 30 ms | 55 ms | 108 ms | 14579 |
| quote_convert | 52 ms | 289 ms | 441 ms | 522 |
| quote_create | 59 ms | 321 ms | 407 ms | 522 |
| session | 32 ms | 453 ms | 666 ms | 522 |

