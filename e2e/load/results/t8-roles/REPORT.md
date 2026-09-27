# Load test — t8-roles

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 487 | 101 | 272 ms | 5849 ms | 1124 ms | 20.3 s | 4.6 vCPU | 5.3 GiB | 1317/2871 m | 725/1794 m | 49 | wait 0, drained in 0 s | none |

## Per step

**50 VUs** — 487 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 1782/1856, worker 1593/1658, postgres 108/154, redis 23/24, ocr 87/237, mailpit 62/67

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 54 ms | 396 ms | 627 ms | 504 |
| dashboard | 68 ms | 492 ms | 627 ms | 504 |
| invoice_pdf | 609 ms | 5849 ms | 9504 ms | 504 |
| invoice_send | 124 ms | 1124 ms | 1891 ms | 504 |
| list_clients | 42 ms | 272 ms | 462 ms | 504 |
| list_invoices | 40 ms | 224 ms | 368 ms | 504 |
| list_quotes | 41 ms | 221 ms | 389 ms | 504 |
| ocr_upload | 589 ms | 1300 ms | 1395 ms | 100 |
| poll_invoice | 98 ms | 331 ms | 500 ms | 4247 |
| poll_ocr | 31 ms | 82 ms | 157 ms | 12378 |
| quote_convert | 55 ms | 549 ms | 710 ms | 504 |
| quote_create | 58 ms | 524 ms | 814 ms | 504 |
| session | 35 ms | 506 ms | 793 ms | 504 |

