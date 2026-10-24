# ERP-1 Mapping & Value Translation (ERP1-28 / KIT-05)

Templates live in `sample-data/erp-1/mapping-template.json`; logic in `apps/erp/modules/erp-1/src/migration/mapping-config.ts`.

## Template contract
| Property | Meaning |
|---|---|
| `name` | Stable template name, e.g. `erp1-products-import` |
| `version` | Semantic version `x.y.z`; any content change requires a bump |
| `entity` | `category` \| `warehouse` \| `product` \| `stock_level` |
| `fields[]` | `source` (file column), `target` (schema attribute), `type`, `required`, optional `enumTable`, `decimalScale`, `dateFormat`, `sensitive` |
| `enumTranslations` | Per-table `allowed` allowlist and `map` (source value -> target value, case/space-insensitive) |

Reproducibility: `templateFingerprint()` is a SHA-256 over key-sorted canonical JSON; the same template yields the identical fingerprint on every run. Dry-run results carry `templateId` (`name@version`) and the fingerprint.

## Type coercion
| Type | Rule |
|---|---|
| string | trimmed |
| integer | `^-?\d+$` |
| decimal | string-based half-up rounding to `decimalScale` (default 2, max 8); thousands commas stripped; no floating point |
| date | `iso` (YYYY-MM-DD); impossible dates rejected; output ISO |
| boolean | true/yes/1, false/no/0 |
| enum | translated via the named table; value must be in the allowlist |

## Required target columns (enforcement guard)
| Entity | Required targets |
|---|---|
| category | code, name |
| warehouse | code, name |
| product | sku, name, category_code, unit_of_measure, price, currency |
| stock_level | sku, warehouse_code, quantity, as_of_date |

A template that leaves any of these unmapped, or mapped as optional, fails validation. Dry-run additionally fails when a required source column is absent from the file header. Failures raise `MappingValidationError` (HTTP 400, envelope `{ code: "MAPPING_VALIDATION_FAILED", message, details: { issues } }`) before any row is processed.

## Enum allowlists
- Units of Measure (FR-ERP1-04): `pcs`, `kg`, `g`, `litre`, `metre`, `box`
- Currencies: `USD`, `EUR`, `GBP`, `INR`
- Booleans: `true`, `false`

## Sensitive data
Fields flagged `sensitive` (e.g. `supplier_bank_account`, `employee_ssn`) are never echoed in row errors; row errors contain only row index, target, source column, and reason.
