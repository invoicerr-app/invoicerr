# Load test — t6-autoscale

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 1905 | 30 | 312 ms | 15.9 s | 8639 ms | 47.4 s | 2.0 vCPU | 4.7 GiB | 896/1229 m | 288/684 m | 52 | wait 0, drained in 0 s | 16984/25013 checks |

## Per step

**50 VUs** — 1905 loops, 0 failed sends, 44 timed out; memory avg/peak MiB: api 1613/1676, worker 1525/1601, postgres 87/159, redis 24/33, ocr 13/13, mailpit 42/48

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 72 ms | 436 ms | 1159 ms | 1905 |
| dashboard | 71 ms | 562 ms | 1090 ms | 1905 |
| invoice_pdf | 1860 ms | 15.9 s | 17.3 s | 199 |
| invoice_send | 1208 ms | 8639 ms | 10.3 s | 199 |
| list_clients | 69 ms | 312 ms | 683 ms | 1905 |
| list_invoices | 17 ms | 253 ms | 527 ms | 1905 |
| list_quotes | 17 ms | 224 ms | 502 ms | 1905 |
| ocr_upload | 81 ms | 81 ms | 81 ms | 1 |
| poll_invoice | 130 ms | 847 ms | 1320 ms | 10685 |
| quote_convert | 564 ms | 1736 ms | 1896 ms | 199 |
| quote_create | 72 ms | 500 ms | 1318 ms | 1905 |
| session | 55 ms | 299 ms | 1424 ms | 1905 |

