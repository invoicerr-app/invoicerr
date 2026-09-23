# Load test — t2-2core

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 236 | 47 | 265 ms | 2008 ms | 920 ms | 3687 ms | 2.0 vCPU | 4.4 GiB | 573/1011 m | 383/853 m | 25 | wait 0, drained in 0 s | none |
| 50 | 277 | 60 | 1225 ms | 14.8 s | 4414 ms | 36.9 s | 2.0 vCPU | 4.5 GiB | 673/1279 m | 380/1116 m | 38 | wait 0, drained in 0 s | 9/16813 checks |

## Per step

**10 VUs** — 236 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1083/1158, worker 1642/1692, postgres 88/112, redis 22/23, ocr 156/319, mailpit 42/48

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 37 ms | 481 ms | 637 ms | 236 |
| dashboard | 51 ms | 566 ms | 812 ms | 236 |
| invoice_pdf | 471 ms | 2008 ms | 2669 ms | 236 |
| invoice_send | 75 ms | 920 ms | 1327 ms | 236 |
| list_clients | 30 ms | 265 ms | 568 ms | 236 |
| list_invoices | 32 ms | 205 ms | 338 ms | 236 |
| list_quotes | 36 ms | 198 ms | 423 ms | 236 |
| ocr_upload | 114 ms | 378 ms | 499 ms | 47 |
| poll_invoice | 50 ms | 396 ms | 522 ms | 315 |
| poll_ocr | 39 ms | 154 ms | 225 ms | 2309 |
| quote_convert | 42 ms | 445 ms | 677 ms | 236 |
| quote_create | 45 ms | 452 ms | 673 ms | 236 |
| session | 30 ms | 254 ms | 347 ms | 236 |

**50 VUs** — 277 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1162/1269, worker 1692/1747, postgres 111/136, redis 23/29, ocr 183/341, mailpit 49/49

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 351 ms | 1290 ms | 1808 ms | 299 |
| dashboard | 532 ms | 1668 ms | 2332 ms | 299 |
| invoice_pdf | 2073 ms | 14.8 s | 19.2 s | 299 |
| invoice_send | 1465 ms | 4414 ms | 5518 ms | 299 |
| list_clients | 341 ms | 1225 ms | 1534 ms | 299 |
| list_invoices | 185 ms | 914 ms | 1366 ms | 299 |
| list_quotes | 197 ms | 948 ms | 1314 ms | 299 |
| ocr_upload | 156 ms | 574 ms | 638 ms | 59 |
| poll_invoice | 538 ms | 1354 ms | 1768 ms | 4852 |
| poll_ocr | 45 ms | 255 ms | 518 ms | 8277 |
| quote_convert | 443 ms | 1564 ms | 2071 ms | 299 |
| quote_create | 612 ms | 1724 ms | 2050 ms | 299 |
| session | 177 ms | 843 ms | 1121 ms | 299 |

