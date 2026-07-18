# Evaluation v2 adversarial fixtures

The focused test builds its valid and invalid packs in a temporary directory. No reviewed manual decision, subject selection, teacher mask, or phase lock is committed here.

The generated cases cover the exact 6,711-row source denominator, frame and interval materialization, base and overlay windows, dual label/subject review, state/target/anchor adjudication and final binding, zero-disagreement handling, kappa floors, contact and reacquire gates, current-teacher confidence unavailability, P0/P1 manifests, external anchors, recursive forbidden-field scanning, and fully rehashed tampering.

Run `node tests/sam-goal-label-audit-v2-check.mjs` to regenerate and audit every case. Temporary `sam-eval-v2-*` directories are removed on normal and failing exits, and the suite proves the failing cleanup path with a child process.
