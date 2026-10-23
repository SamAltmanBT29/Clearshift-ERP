# AI Review Card: Before You Accept Generated Code

Run through this card before staging any AI-assisted change.

- [ ] Did I provide the full live issue and relevant approved design?
- [ ] Did the agent inspect the repo before proposing files or APIs?
- [ ] Did I review and approve the implementation plan before edits?
- [ ] Is every file change justified by an acceptance criterion?
- [ ] Did I read every changed line?
- [ ] Do tests cover at least one failure/negative path?
- [ ] Are API contract, type definitions and runtime validation aligned?
- [ ] Are DB constraints/transactions correct?
- [ ] Are retries idempotent and event consumers safe against duplicate delivery?
- [ ] Are privacy/sensitive data/secrets protected?
- [ ] Are source row outcomes exact and reconciled for migration-related changes?
- [ ] Did I run the real commands and check the actual results?
- [ ] Can I explain this code to a reviewer without asking the AI to explain it live?
- [ ] Is the PR small, linked to the correct GitHub issue number, and free of unrelated refactoring?

**If any box is unchecked, the PR is not ready.**
