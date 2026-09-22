# Load test — run1-1api-3workers

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 120 | 24 | 38 ms | 435 ms | 76 ms | 1030 ms | 1.5 vCPU | 2.8 GiB | 435/600 m | 341/484 m | 9 | wait 0, drained in 1 s | 3/1584 checks |
| 2 | 230 | 46 | 51 ms | 549 ms | 71 ms | 1033 ms | 2.3 vCPU | 3.0 GiB | 612/766 m | 420/566 m | 13 | wait 0, drained in 1 s | 12/3036 checks |
| 10 | 260 | 52 | 86 ms | 977 ms | 226 ms | 1058 ms | 6.0 vCPU | 4.8 GiB | 545/1273 m | 411/1433 m | 18 | wait 0, drained in 1 s | 2/3432 checks |
| 50 | 10383 | 110 | 41 ms | 10.3 s | 1666 ms | 2361 ms | 6.0 vCPU | 21.7 GiB | 1368/2783 m | 1120/2376 m | 22 | wait 0, drained in 1 s | 69664/76997 checks |

## Per step

**1 VUs** — 120 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 511/530, worker 1447/1480, postgres 49/52, redis 10/12, ocr 30/103, mailpit 50/55

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 31 ms | 35 ms | 37 ms | 120 |
| dashboard | 63 ms | 73 ms | 76 ms | 120 |
| invoice_pdf | 395 ms | 435 ms | 449 ms | 120 |
| invoice_send | 65 ms | 76 ms | 131 ms | 120 |
| list_clients | 28 ms | 32 ms | 33 ms | 120 |
| list_invoices | 31 ms | 35 ms | 38 ms | 120 |
| list_quotes | 30 ms | 38 ms | 39 ms | 120 |
| ocr_upload | 3669 ms | 3781 ms | 3789 ms | 24 |
| poll_invoice | 26 ms | 30 ms | 34 ms | 120 |
| quote_convert | 39 ms | 44 ms | 48 ms | 120 |
| quote_create | 41 ms | 49 ms | 64 ms | 120 |
| session | 24 ms | 27 ms | 40 ms | 120 |

**2 VUs** — 230 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 544/582, worker 1470/1516, postgres 61/64, redis 10/11, ocr 93/466, mailpit 61/69

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 35 ms | 48 ms | 58 ms | 230 |
| dashboard | 76 ms | 107 ms | 121 ms | 230 |
| invoice_pdf | 463 ms | 549 ms | 594 ms | 230 |
| invoice_send | 56 ms | 71 ms | 88 ms | 230 |
| list_clients | 30 ms | 36 ms | 43 ms | 230 |
| list_invoices | 32 ms | 43 ms | 55 ms | 230 |
| list_quotes | 33 ms | 51 ms | 61 ms | 230 |
| ocr_upload | 3694 ms | 3863 ms | 3903 ms | 46 |
| poll_invoice | 27 ms | 32 ms | 37 ms | 230 |
| quote_convert | 41 ms | 49 ms | 67 ms | 230 |
| quote_create | 43 ms | 53 ms | 128 ms | 230 |
| session | 25 ms | 31 ms | 48 ms | 230 |

**10 VUs** — 260 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 543/589, worker 1473/1502, postgres 58/71, redis 11/11, ocr 1630/2253, mailpit 71/72

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 33 ms | 92 ms | 159 ms | 260 |
| dashboard | 53 ms | 141 ms | 204 ms | 260 |
| invoice_pdf | 420 ms | 977 ms | 1837 ms | 260 |
| invoice_send | 75 ms | 226 ms | 312 ms | 260 |
| list_clients | 27 ms | 86 ms | 96 ms | 260 |
| list_invoices | 28 ms | 73 ms | 88 ms | 260 |
| list_quotes | 33 ms | 74 ms | 104 ms | 260 |
| ocr_upload | 52.4 s | 59.5 s | 60.1 s | 52 |
| poll_invoice | 25 ms | 58 ms | 96 ms | 260 |
| quote_convert | 38 ms | 114 ms | 126 ms | 260 |
| quote_create | 40 ms | 118 ms | 144 ms | 260 |
| session | 22 ms | 67 ms | 195 ms | 260 |

**50 VUs** — 10383 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 618/709, worker 1497/1551, postgres 70/102, redis 13/18, ocr 8786/19059, mailpit 73/78

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 11 ms | 36 ms | 302 ms | 10388 |
| dashboard | 11 ms | 52 ms | 414 ms | 10388 |
| invoice_pdf | 7130 ms | 10.3 s | 60.0 s | 584 |
| invoice_send | 298 ms | 1666 ms | 31.6 s | 584 |
| list_clients | 11 ms | 41 ms | 263 ms | 10388 |
| list_invoices | 11 ms | 34 ms | 187 ms | 10388 |
| list_quotes | 11 ms | 35 ms | 181 ms | 10388 |
| ocr_upload | 60.1 s | 66.5 s | 76.5 s | 132 |
| poll_invoice | 45 ms | 237 ms | 2471 ms | 1261 |
| quote_convert | 141 ms | 776 ms | 898 ms | 584 |
| quote_create | 11 ms | 67 ms | 459 ms | 10388 |
| session | 11 ms | 19 ms | 156 ms | 10388 |

