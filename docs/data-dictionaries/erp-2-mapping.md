# ERP-2 Mapping & Value Translation (ERP2-28)

Templates live in `sample-data/erp-2/mapping-template.json`; logic in `apps/erp/modules/erp-2/src/migration/mapping-config.ts`.

## Template contract
| Property | Meaning |
|---|---|
| `name` | Stable template name, e.g. `erp2-vendors-import` |
| `version` | Semantic version `x.y.z`; any content change requires a bump |
| `entity` | `vendors` \| `purchase_orders` \| `po_lines` |
| `fields[]` | `source` (file column), `target` (schema attribute), `type`, `required`, optional `enumTable`, `decimalScale`, `dateFormat`, `sensitive` |
| `enumTranslations` | Per-table `allowed` allowlist and `map` (source value -> target value, case/space-insensitive) |

Reproducibility: `templateFingerprint()` is a SHA-256 over key-sorted canonical JSON; the same template yields the same fingerprint every run. Dry-run results carry `templateId` (`name@version`) and the fingerprint.

## Type coercion
| Type | Rule |
|---|---|
| string | trimmed |
| integer | `^-?\d+$` |
| decimal | string-based half-up rounding to `decimalScale` (default 2, max 8); thousands commas stripped; no floating point |
| date | `iso` (YYYY-MM-DD) or `dmy` (DD/MM/YYYY); impossible dates rejected; output ISO |
| boolean | true/yes/y/1, false/no/n/0 |
| enum | translated via the named table; value must be in the allowlist |

## Required target columns (enforcement guard)
| Entity | Required targets |
|---|---|
| vendors | vendor_code, name, status |
| purchase_orders | po_number, vendor_code, status, order_date |
| po_lines | po_number, line_no, product_sku, quantity, unit_price |

A template that leaves any of these unmapped, or mapped as optional, fails validation. Dry-run additionally fails when a required source column is absent from the file header. Failures raise `MappingValidationError` (HTTP 400, envelope `{ code: "MAPPING_VALIDATION_FAILED", message, details: { issues } }`) before any row is processed.

## Enum allowlists
- PO status: `draft`, `sent`, `received`, `closed` (transitions Draft -> Sent -> Received -> Closed are enforced by the domain layer, not by import mapping)
- Vendor status: `active`, `inactive`

## Sensitive data
Fields flagged `sensitive` (e.g. `bank_iban`) are never echoed in row errors; row errors contain only row index, target, source column and reason.
