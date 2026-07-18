# Audit fixtures

`tests/sam-goal-label-audit-check.mjs` generates its audit packs in a temporary
directory. The valid pack contains 7,007 decoder rows and separate decoder,
manual-window, manual-label, and teacher-mask artifacts. Failure copies mutate
one contract dimension at a time.

No real manual labels or P1 teacher-valid mask are stored here. That separation
is intentional: this module freezes the P0 rule/schema/audit contract only. A
dependent manual-label-pack module must curate the real windows and rows, and P1
must create and freeze the actual teacher mask without using live/student output.
