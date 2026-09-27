# Load test — run4-ocr-async

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 115 | 23 | 40 ms | 448 ms | 75 ms | 1030 ms | 1.5 vCPU | 2.8 GiB | 402/542 m | 349/449 m | 10 | wait 0, drained in 0 s | 3/1633 checks |
| 2 | 222 | 44 | 51 ms | 569 ms | 94 ms | 1034 ms | 2.5 vCPU | 3.0 GiB | 698/806 m | 520/719 m | 13 | wait 0, drained in 0 s | 14/3155 checks |
| 10 | 409 | 82 | 58 ms | 773 ms | 126 ms | 1046 ms | 4.8 vCPU | 3.0 GiB | 1049/1247 m | 712/1249 m | 18 | wait 0, drained in 0 s | 36/7749 checks |
| 50 | 530 | 109 | 381 ms | 9003 ms | 383 ms | 1121 ms | 5.6 vCPU | 3.1 GiB | 1205/2800 m | 711/2348 m | 20 | wait 0, drained in 0 s | 74/22274 checks |

## Per step

**1 VUs** — 115 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 548/574, worker 1469/1509, postgres 52/56, redis 10/10, ocr 74/242, mailpit 38/53

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 30 ms | 34 ms | 37 ms | 115 |
| dashboard | 50 ms | 66 ms | 71 ms | 115 |
| invoice_pdf | 417 ms | 448 ms | 454 ms | 115 |
| invoice_send | 66 ms | 75 ms | 96 ms | 115 |
| list_clients | 27 ms | 33 ms | 35 ms | 115 |
| list_invoices | 30 ms | 34 ms | 38 ms | 115 |
| list_quotes | 32 ms | 40 ms | 43 ms | 115 |
| ocr_upload | 98 ms | 125 ms | 153 ms | 23 |
| poll_invoice | 26 ms | 29 ms | 30 ms | 115 |
| poll_ocr | 26 ms | 30 ms | 34 ms | 92 |
| quote_convert | 39 ms | 43 ms | 47 ms | 115 |
| quote_create | 40 ms | 49 ms | 60 ms | 115 |
| session | 23 ms | 27 ms | 28 ms | 115 |

**2 VUs** — 222 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 588/639, worker 1527/1584, postgres 61/65, redis 10/11, ocr 49/241, mailpit 64/68

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 33 ms | 51 ms | 66 ms | 222 |
| dashboard | 69 ms | 90 ms | 108 ms | 222 |
| invoice_pdf | 437 ms | 569 ms | 579 ms | 222 |
| invoice_send | 63 ms | 94 ms | 280 ms | 222 |
| list_clients | 28 ms | 38 ms | 50 ms | 222 |
| list_invoices | 31 ms | 44 ms | 58 ms | 222 |
| list_quotes | 32 ms | 51 ms | 69 ms | 222 |
| ocr_upload | 100 ms | 113 ms | 123 ms | 44 |
| poll_invoice | 26 ms | 33 ms | 39 ms | 222 |
| poll_ocr | 25 ms | 35 ms | 38 ms | 181 |
| quote_convert | 39 ms | 47 ms | 52 ms | 222 |
| quote_create | 41 ms | 54 ms | 96 ms | 222 |
| session | 24 ms | 32 ms | 51 ms | 222 |

**10 VUs** — 409 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 624/676, worker 1543/1566, postgres 65/71, redis 11/12, ocr 108/237, mailpit 70/71

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 34 ms | 63 ms | 99 ms | 409 |
| dashboard | 49 ms | 106 ms | 138 ms | 409 |
| invoice_pdf | 433 ms | 773 ms | 1633 ms | 409 |
| invoice_send | 63 ms | 126 ms | 168 ms | 409 |
| list_clients | 29 ms | 58 ms | 79 ms | 409 |
| list_invoices | 31 ms | 52 ms | 71 ms | 409 |
| list_quotes | 36 ms | 53 ms | 75 ms | 409 |
| ocr_upload | 98 ms | 126 ms | 201 ms | 81 |
| poll_invoice | 27 ms | 45 ms | 58 ms | 409 |
| poll_ocr | 27 ms | 46 ms | 62 ms | 2270 |
| quote_convert | 41 ms | 81 ms | 138 ms | 409 |
| quote_create | 42 ms | 89 ms | 226 ms | 409 |
| session | 25 ms | 44 ms | 126 ms | 409 |

**50 VUs** — 530 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 651/718, worker 1560/1619, postgres 68/81, redis 13/13, ocr 125/240, mailpit 71/71

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 53 ms | 554 ms | 700 ms | 545 |
| dashboard | 69 ms | 777 ms | 868 ms | 545 |
| invoice_pdf | 557 ms | 9003 ms | 9437 ms | 545 |
| invoice_send | 96 ms | 383 ms | 576 ms | 545 |
| list_clients | 43 ms | 381 ms | 436 ms | 545 |
| list_invoices | 40 ms | 279 ms | 357 ms | 545 |
| list_quotes | 42 ms | 184 ms | 277 ms | 545 |
| ocr_upload | 103 ms | 185 ms | 210 ms | 108 |
| poll_invoice | 39 ms | 106 ms | 162 ms | 556 |
| poll_ocr | 30 ms | 61 ms | 85 ms | 14977 |
| quote_convert | 61 ms | 550 ms | 697 ms | 545 |
| quote_create | 64 ms | 543 ms | 754 ms | 545 |
| session | 30 ms | 343 ms | 458 ms | 545 |

