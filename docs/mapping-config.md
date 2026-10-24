# ERP-1 Mapping & Value Translation Configuration

This document outlines the mapping templates and value translation policies for the ERP-1 module.

## Mapping Template
- Located at `sample-data/erp-1/mapping-template.json`.
- Defines source-to-target field mappings, enumeration validation, foreign key lookups, and defaults.
- Enforces strict policies:
  - No fuzzy matching.
  - No automatic merges.
  - Raw input mutation prohibited.
  - Exact duplicate handling only.
  - SKU normalization to uppercase and trimmed.
  - Unit of Measure must be one of: `pcs`, `kg`, `g`, `litre`, `metre`, `box`.

## Validation
- Required fields are validated both at API layer (via Zod schemas) and in‑process target adapter pre‑flight.
- Unmapped required target fields result in a `400 Bad Request` with detailed error messages.

## Versioning
- Mapping schema version is `1`.
- Rules version is `1.0.0`.

Refer to the official SDS for full specifications.
