# Load test — run2-no-ocr

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 167 | 33 | 41 ms | 453 ms | 81 ms | 1034 ms | 1.5 vCPU | 3.6 GiB | 564/678 m | 458/648 m | 10 | wait 0, drained in 2 s | 5/2171 checks |
| 2 | 312 | 62 | 60 ms | 563 ms | 76 ms | 1037 ms | 2.0 vCPU | 3.7 GiB | 847/1016 m | 594/756 m | 14 | wait 0, drained in 1 s | 20/4056 checks |
| 10 | 1164 | 233 | 93 ms | 1093 ms | 267 ms | 1093 ms | 5.3 vCPU | 3.8 GiB | 2263/2645 m | 1870/2216 m | 17 | wait 0, drained in 1 s | 307/15140 checks |
| 50 | 1292 | 258 | 227 ms | 10.2 s | 588 ms | 2239 ms | 5.7 vCPU | 3.8 GiB | 2461/2821 m | 2066/2415 m | 21 | wait 0, drained in 2 s | 372/16948 checks |

## Per step

**1 VUs** — 167 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 495/526, worker 1529/1560, postgres 78/83, redis 23/23, mailpit 71/87

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 32 ms | 36 ms | 41 ms | 167 |
| dashboard | 62 ms | 78 ms | 83 ms | 167 |
| invoice_pdf | 408 ms | 453 ms | 462 ms | 167 |
| invoice_send | 67 ms | 81 ms | 88 ms | 167 |
| list_clients | 29 ms | 33 ms | 44 ms | 167 |
| list_invoices | 32 ms | 37 ms | 40 ms | 167 |
| list_quotes | 32 ms | 41 ms | 44 ms | 167 |
| poll_invoice | 28 ms | 33 ms | 38 ms | 167 |
| quote_convert | 41 ms | 48 ms | 56 ms | 167 |
| quote_create | 43 ms | 49 ms | 61 ms | 167 |
| session | 25 ms | 29 ms | 33 ms | 167 |

**2 VUs** — 312 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 545/618, worker 1579/1613, postgres 90/96, redis 23/26, mailpit 84/88

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 38 ms | 55 ms | 69 ms | 312 |
| dashboard | 84 ms | 117 ms | 134 ms | 312 |
| invoice_pdf | 484 ms | 563 ms | 595 ms | 312 |
| invoice_send | 59 ms | 76 ms | 158 ms | 312 |
| list_clients | 31 ms | 39 ms | 44 ms | 312 |
| list_invoices | 34 ms | 54 ms | 69 ms | 312 |
| list_quotes | 35 ms | 60 ms | 73 ms | 312 |
| poll_invoice | 29 ms | 36 ms | 40 ms | 312 |
| quote_convert | 44 ms | 53 ms | 64 ms | 312 |
| quote_create | 46 ms | 55 ms | 178 ms | 312 |
| session | 27 ms | 34 ms | 39 ms | 312 |

**10 VUs** — 1164 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 598/680, worker 1617/1655, postgres 101/108, redis 25/25, mailpit 89/90

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 58 ms | 111 ms | 170 ms | 1164 |
| dashboard | 98 ms | 185 ms | 243 ms | 1164 |
| invoice_pdf | 829 ms | 1093 ms | 1295 ms | 1164 |
| invoice_send | 153 ms | 267 ms | 440 ms | 1164 |
| list_clients | 49 ms | 93 ms | 127 ms | 1164 |
| list_invoices | 48 ms | 89 ms | 120 ms | 1164 |
| list_quotes | 51 ms | 92 ms | 118 ms | 1164 |
| poll_invoice | 43 ms | 88 ms | 124 ms | 1172 |
| quote_convert | 72 ms | 135 ms | 184 ms | 1164 |
| quote_create | 77 ms | 144 ms | 222 ms | 1164 |
| session | 33 ms | 68 ms | 112 ms | 1164 |

**50 VUs** — 1292 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 670/721, worker 1649/1685, postgres 110/121, redis 25/25, mailpit 91/91

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 95 ms | 256 ms | 732 ms | 1292 |
| dashboard | 142 ms | 352 ms | 1020 ms | 1292 |
| invoice_pdf | 9546 ms | 10.2 s | 10.6 s | 1292 |
| invoice_send | 260 ms | 588 ms | 1040 ms | 1292 |
| list_clients | 78 ms | 227 ms | 434 ms | 1292 |
| list_invoices | 71 ms | 184 ms | 413 ms | 1292 |
| list_quotes | 74 ms | 182 ms | 251 ms | 1292 |
| poll_invoice | 72 ms | 157 ms | 343 ms | 1444 |
| quote_convert | 122 ms | 412 ms | 795 ms | 1292 |
| quote_create | 126 ms | 435 ms | 890 ms | 1292 |
| session | 48 ms | 139 ms | 447 ms | 1292 |

