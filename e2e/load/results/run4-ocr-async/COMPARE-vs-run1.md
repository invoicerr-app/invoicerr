# Load test comparison

Before: `results/run1-1api-3workers` · After: `results/run4-ocr-async`

## 1 VUs

| step | before p95 | after p95 | change |
|---|---|---|---|
| company_info | 35 ms | 34 ms | -5 % |
| dashboard | 73 ms | 66 ms | -10 % |
| invoice_pdf | 435 ms | 448 ms | +3 % |
| invoice_send | 76 ms | 75 ms | -1 % |
| list_clients | 32 ms | 33 ms | +5 % |
| list_invoices | 35 ms | 34 ms | -4 % |
| list_quotes | 38 ms | 40 ms | +6 % |
| ocr_upload | 3781 ms | 125 ms | -97 % |
| poll_invoice | 30 ms | 29 ms | -4 % |
| quote_convert | 44 ms | 43 ms | -4 % |
| quote_create | 49 ms | 49 ms | -0 % |
| session | 27 ms | 27 ms | -2 % |

Node CPU peak 1.5 → 1.5 vCPU (+1 %), RAM peak 2.8 → 2.8 GiB.

## 2 VUs

| step | before p95 | after p95 | change |
|---|---|---|---|
| company_info | 48 ms | 51 ms | +8 % |
| dashboard | 107 ms | 90 ms | -16 % |
| invoice_pdf | 549 ms | 569 ms | +4 % |
| invoice_send | 71 ms | 94 ms | +33 % |
| list_clients | 36 ms | 38 ms | +7 % |
| list_invoices | 43 ms | 44 ms | +1 % |
| list_quotes | 51 ms | 51 ms | -1 % |
| ocr_upload | 3863 ms | 113 ms | -97 % |
| poll_invoice | 32 ms | 33 ms | +2 % |
| quote_convert | 49 ms | 47 ms | -5 % |
| quote_create | 53 ms | 54 ms | +1 % |
| session | 31 ms | 32 ms | +1 % |

Node CPU peak 2.3 → 2.5 vCPU (+9 %), RAM peak 3.0 → 3.0 GiB.

## 10 VUs

| step | before p95 | after p95 | change |
|---|---|---|---|
| company_info | 92 ms | 63 ms | -31 % |
| dashboard | 141 ms | 106 ms | -25 % |
| invoice_pdf | 977 ms | 773 ms | -21 % |
| invoice_send | 226 ms | 126 ms | -44 % |
| list_clients | 86 ms | 58 ms | -32 % |
| list_invoices | 73 ms | 52 ms | -28 % |
| list_quotes | 74 ms | 53 ms | -27 % |
| ocr_upload | 59.5 s | 126 ms | -100 % |
| poll_invoice | 58 ms | 45 ms | -21 % |
| quote_convert | 114 ms | 81 ms | -29 % |
| quote_create | 118 ms | 89 ms | -25 % |
| session | 67 ms | 44 ms | -34 % |

Node CPU peak 6.0 → 4.8 vCPU (-20 %), RAM peak 4.8 → 3.0 GiB.

## 50 VUs

| step | before p95 | after p95 | change |
|---|---|---|---|
| company_info | 36 ms | 554 ms | +1431 % |
| dashboard | 52 ms | 777 ms | +1398 % |
| invoice_pdf | 10.3 s | 9003 ms | -13 % |
| invoice_send | 1666 ms | 383 ms | -77 % |
| list_clients | 41 ms | 381 ms | +822 % |
| list_invoices | 34 ms | 279 ms | +718 % |
| list_quotes | 35 ms | 184 ms | +432 % |
| ocr_upload | 66.5 s | 185 ms | -100 % |
| poll_invoice | 237 ms | 106 ms | -55 % |
| quote_convert | 776 ms | 550 ms | -29 % |
| quote_create | 67 ms | 543 ms | +709 % |
| session | 19 ms | 343 ms | +1735 % |

Node CPU peak 6.0 → 5.6 vCPU (-6 %), RAM peak 21.7 → 3.1 GiB.

