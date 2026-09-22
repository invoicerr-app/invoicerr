# Load test — run5-3api

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 1302 | 260 | 170 ms | 1479 ms | 488 ms | 11.1 s | 5.8 vCPU | 4.0 GiB | 2667/3098 m | 1933/2289 m | 43 | wait 0, drained in 0 s | 148/27617 checks |

## Per step

**50 VUs** — 1302 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1778/1875, worker 1618/1678, postgres 127/152, redis 14/15, ocr 19/19, mailpit 73/80

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 73 ms | 216 ms | 355 ms | 1302 |
| dashboard | 95 ms | 265 ms | 360 ms | 1302 |
| invoice_pdf | 760 ms | 1479 ms | 5412 ms | 1302 |
| invoice_send | 191 ms | 488 ms | 809 ms | 1302 |
| list_clients | 52 ms | 170 ms | 242 ms | 1302 |
| list_invoices | 50 ms | 143 ms | 198 ms | 1302 |
| list_quotes | 55 ms | 138 ms | 184 ms | 1302 |
| poll_invoice | 59 ms | 153 ms | 218 ms | 11993 |
| quote_convert | 77 ms | 263 ms | 426 ms | 1302 |
| quote_create | 83 ms | 300 ms | 543 ms | 1302 |
| session | 38 ms | 142 ms | 309 ms | 1302 |

