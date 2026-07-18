# Manual pack compiler fixtures

The focused compiler suite creates synthetic review A, review B, adjudication, compiled P0 candidates, and external anchors under an isolated temporary directory. No real review decision or repository label pack is stored here.

The generated cases cover all 6,711 decoder identities, independent reviewer roles and pseudonyms, frame-index interval mapping, final adjudicated windows, subject state/target/anchor disagreements, deterministic compilation, accepted P0 audit gates, atomic output failure, and write-once external anchors.

Run `node tests/sam-goal-manual-pack-v2-check.mjs`. The suite removes its temporary root on success, assertion failure, SIGINT, and SIGTERM.
