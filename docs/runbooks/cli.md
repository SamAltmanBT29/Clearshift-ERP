# ClearShift Migration Kit CLI Runbook (KIT-15)

## Commands

```bash
cs-kit batch create --module erp1 --file data.csv --date-format DD-MM-YYYY --phone-country +91
cs-kit run --batch B-00001 --steps extract,profile,clean,map,dry-run
cs-kit run --batch B-00001 --steps load,validate,reconcile
cs-kit report reconcile --batch B-00001 --out report.csv
```

## Exit Codes

- `0` — success / reconciliation OK
- `1` — validation failure (bad flags, unknown module/step, missing batch, missing file)
- `2` — system failure or failed reconciliation

## Notes

- CLI is a thin client of the shared batch engine in `apps/migration-kit/cli/batch-engine.ts`.
- Batch state is persisted in `CS_KIT_DATA_DIR` (default `.cs-kit/batches.json`).
- CSV inputs are limited to 50 MB; XLSX is not parsed in V1 CLI.
