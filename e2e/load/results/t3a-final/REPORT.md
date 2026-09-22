# Load test — t3a-final

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 527 | 108 | 1174 ms | 7136 ms | 920 ms | 2418 ms | 5.9 vCPU | 3.7 GiB | 1138/2845 m | 809/2538 m | 22 | wait 0, drained in 0 s | 76/20711 checks |

## Per step

**50 VUs** — 527 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 790/1008, worker 1458/1506, postgres 78/93, redis 12/14, ocr 108/239, mailpit 75/80

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 87 ms | 760 ms | 910 ms | 540 |
| dashboard | 149 ms | 958 ms | 1278 ms | 540 |
| invoice_pdf | 1857 ms | 7136 ms | 9273 ms | 540 |
| invoice_send | 171 ms | 920 ms | 1223 ms | 540 |
| list_clients | 82 ms | 452 ms | 691 ms | 540 |
| list_invoices | 344 ms | 1174 ms | 2127 ms | 540 |
| list_quotes | 285 ms | 1044 ms | 2222 ms | 540 |
| ocr_upload | 435 ms | 928 ms | 1236 ms | 106 |
| poll_invoice | 88 ms | 352 ms | 490 ms | 686 |
| poll_ocr | 44 ms | 286 ms | 522 ms | 13346 |
| quote_convert | 121 ms | 639 ms | 963 ms | 540 |
| quote_create | 133 ms | 746 ms | 987 ms | 540 |
| session | 68 ms | 569 ms | 866 ms | 540 |

