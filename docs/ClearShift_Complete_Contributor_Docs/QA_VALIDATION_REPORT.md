# Contributor Guide Artifact Validation

Date: 19 October 2026

## Outputs

- `ClearShift_Team_Contributor_Guide.md` - canonical editable source.
- `ClearShift_Team_Contributor_Guide.pdf` - print-ready A4 PDF.
- `AI_Prompt_Playbook.md` - copy-ready prompts for common engineering phases.
- `CONTRIBUTOR_QUICK_START.md` - one-page working checklist.
- `.github/PULL_REQUEST_TEMPLATE.md` - proposed PR template.
- `.agents/rules/clearshift-core.md` - proposed Antigravity workspace rule.
- `.agents/skills/clearshift-issue-execution/SKILL.md` - proposed Antigravity skill.

## Validation performed

- PDF created from the canonical Markdown with Pandoc/XeLaTeX.
- `pdfinfo`: 24 pages, A4 (595.28 x 841.89 pt), not encrypted.
- PDF preflight: openable in PyMuPDF, selectable/searchable text, not likely scanned, no XFA.
- All 24 pages rendered to PNG for visual inspection of cover, contents, representative middle pages, code samples, tables, checklists and final page.
- Final page contains the remaining sections and reference links; no separate one-line overflow page.
- Source traceability note included: supplied older catalog snapshot counts 148 detailed issue specs while the standardization plan defines a 360-spec target. Guide assumes the live GitHub backlog reported by the requester is the operational assignment source and warns against duplicate creation.

## Limitations

- This package does not modify the live repository, create GitHub issues, assign team members, or change branch protection settings.
- Exact install/test/build script names must be taken from the actual repository's package manifests and contributor docs; they are intentionally not guessed here.
- Proposed Antigravity rule/skill and PR template should be reviewed by maintainers before being copied into the live repository.
