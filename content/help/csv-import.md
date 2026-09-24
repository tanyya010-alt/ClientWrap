---
title: CSV import
description: Import any spreadsheet with column mapping and an error report.
order: 4
---
# CSV import

Open a client → **Results data** → **Import a CSV**. Files up to 2 MB (about 20,000 rows).

## Two layouts are supported

**One row per value** (from most tools):

| date | metric | value | unit |
|---|---|---|---|
| 2026-08-31 | Leads | 44 | leads |

**One column per metric** (typical spreadsheet):

| Month | Sessions | Leads |
|---|---|---|
| 2026-07 | 5120 | 31 |

After choosing the file, click **Preview**, check the column mapping (we suggest one automatically), and click **Import**.

## Values and dates
- Numbers may include thousands separators, currency symbols or `%` (`$1,200`, `12%`). Negative numbers in parentheses work: `(50)`.
- Dates: `2026-08-31`, `2026-08` (first of the month), `31/08/2026`, `08/31/2026` or unix timestamps.

## Errors
Rows that can't be read are skipped and listed with row number, column and reason. Download the full **error report (CSV)**, fix the rows, and import the same file again.

## No duplicates
Re-importing the same file never creates duplicate values. Map a *Unique ID* column if your export has one.

[Download a sample CSV](/samples/clientwrap-sample.csv)
