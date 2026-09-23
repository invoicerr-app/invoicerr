# Load test — run3-12core

One virtual user = one person invoicing without a pause. Sent/min counts invoices that
reached `sent`, e-mail included.

| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 1319 | 264 | 74 ms | 893 ms | 224 ms | 1065 ms | 6.5 vCPU | 2.9 GiB | 2822/3322 m | 2390/2837 m | 17 | wait 0, drained in 0 s | 404/17158 checks |
| 50 | 1762 | 352 | 182 ms | 7069 ms | 438 ms | 1116 ms | 7.9 vCPU | 2.9 GiB | 3771/4043 m | 3114/3410 m | 19 | wait 0, drained in 0 s | 642/22941 checks |

## Per step

**10 VUs** — 1319 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 624/709, worker 1503/1545, postgres 72/78, redis 13/14, ocr 13/13, mailpit 107/126

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 47 ms | 81 ms | 164 ms | 1319 |
| dashboard | 76 ms | 123 ms | 151 ms | 1319 |
| invoice_pdf | 635 ms | 893 ms | 1288 ms | 1319 |
| invoice_send | 122 ms | 224 ms | 680 ms | 1319 |
| list_clients | 42 ms | 74 ms | 115 ms | 1319 |
| list_invoices | 42 ms | 70 ms | 97 ms | 1319 |
| list_quotes | 44 ms | 73 ms | 103 ms | 1319 |
| poll_invoice | 36 ms | 64 ms | 97 ms | 1330 |
| quote_convert | 57 ms | 101 ms | 157 ms | 1319 |
| quote_create | 61 ms | 115 ms | 272 ms | 1319 |
| session | 28 ms | 55 ms | 80 ms | 1319 |

**50 VUs** — 1762 loops, 0 failed sends, 0 timed out; memory avg/peak MiB: api 704/745, worker 1566/1616, postgres 82/88, redis 16/17, ocr 13/13, mailpit 127/127

| step | p50 | p95 | p99 | count |
|---|---|---|---|---|
| company_info | 62 ms | 194 ms | 575 ms | 1762 |
| dashboard | 96 ms | 331 ms | 892 ms | 1762 |
| invoice_pdf | 6717 ms | 7069 ms | 7430 ms | 1762 |
| invoice_send | 171 ms | 438 ms | 1107 ms | 1762 |
| list_clients | 55 ms | 182 ms | 442 ms | 1762 |
| list_invoices | 55 ms | 139 ms | 376 ms | 1762 |
| list_quotes | 62 ms | 135 ms | 261 ms | 1762 |
| poll_invoice | 49 ms | 121 ms | 195 ms | 1797 |
| quote_convert | 85 ms | 321 ms | 709 ms | 1762 |
| quote_create | 82 ms | 401 ms | 799 ms | 1762 |
| session | 37 ms | 82 ms | 355 ms | 1762 |

