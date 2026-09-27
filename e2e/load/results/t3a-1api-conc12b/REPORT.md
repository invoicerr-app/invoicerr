# Load test — t3a-1api-conc12b

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 53586 | 8 | 11 ms | 13.0 s | 3019 ms | 21.6 s | 5.8 vCPU | 3.7 GiB | 1203/3134 m | 1320/3324 m | 26 | wait 0, drained in 0 s | 374449/385339 checks |

## Per step

**50 VUs** — 53586 loops, 81 failed sends, 0 timed out; memory avg/peak MiB: api 561/1101, worker 1409/1542, postgres 63/97, redis 10/11, ocr 111/241, mailpit 26/49

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 10 ms | 11 ms | 15 ms | 53621 |
| dashboard | 10 ms | 11 ms | 15 ms | 53621 |
| invoice_pdf | 3016 ms | 13.0 s | 14.7 s | 365 |
| invoice_send | 665 ms | 3019 ms | 3020 ms | 365 |
| list_clients | 10 ms | 11 ms | 15 ms | 53621 |
| list_invoices | 10 ms | 11 ms | 15 ms | 53621 |
| list_quotes | 10 ms | 11 ms | 15 ms | 53621 |
| ocr_upload | 0 ms | 3991 ms | 4057 ms | 106 |
| poll_invoice | 82 ms | 270 ms | 558 ms | 1990 |
| poll_ocr | 62 ms | 215 ms | 335 ms | 6301 |
| quote_convert | 577 ms | 925 ms | 1084 ms | 367 |
| quote_create | 10 ms | 11 ms | 15 ms | 53621 |
| session | 10 ms | 11 ms | 16 ms | 53621 |

