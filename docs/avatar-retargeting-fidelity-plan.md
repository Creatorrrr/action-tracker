# Avatar Retargeting Fidelity Plan

## Problem

The visible skeleton can look correct while the avatar still shows the wrong
hand face or turns in the opposite direction. The current runtime does not copy
landmark joints directly into avatar bones. It estimates root yaw, aims each
bone toward a target direction, applies secondary axes, clamps twist, smooths
motion, and holds or decays low-confidence targets. The most visible failures
therefore happen at the retargeting boundary:

- hand plane normal sign can turn a camera-visible hand back into an avatar
  palm,
- solver yaw sign can be correct in source coordinates but applied with the
  opposite avatar rotation convention,
- twist limits can hide wrist roll even when hand landmarks are present,
- diagnostics mostly report final quality rather than the source-vs-avatar
  orientation contract.

## Goal

Make skeleton-to-avatar divergence measurable and reduce the two highest-impact
orientation errors: hand palm/back inversion and left/right turn inversion.

## Design

1. Add a renderer-independent orientation helper.
   - Compute raw hand plane normals from wrist, index MCP, and pinky MCP.
   - Apply an explicit source-to-avatar palm-normal sign.
   - Convert solver yaw to avatar yaw with an explicit source-to-avatar yaw sign.
   - Return diagnostics that preserve raw source values and applied avatar
     values.

2. Use the helper in `src/avatar-renderer.js`.
   - Replace inline palm normal sign handling with the helper output.
   - Keep world-hand landmarks preferred over image landmarks.
   - Store hand orientation diagnostics in the avatar snapshot.
   - Apply avatar yaw using the helper so left/right turn direction is not
     implicitly tied to solver coordinate signs.

3. Preserve the current safety rails.
   - Keep body bone angle limits, twist limits, smoothing, and occlusion hold.
   - Do not weaken SAM/csi oracle thresholds or coverage gates.
   - Keep the browser-first runtime and recording JSONL contract.

4. Add regression coverage.
   - Unit-test palm normal raw-vs-applied sign.
   - Unit-test avatar yaw sign mapping and yaw delta diagnostics.
   - Extend contract checks so future renderer edits cannot bypass the helper.
   - Re-run existing synthetic, smoke, perf, and SAM comparison checks.

## Completion Criteria

- `src/retarget-orientation.js` exposes pure palm/yaw orientation helpers.
- `src/avatar-renderer.js` reports source and applied palm/yaw diagnostics.
- Tests cover palm normal sign and yaw sign mapping.
- `npm run check`, `npm run smoke:hud`, and `npm run perf:pump` pass.
- `npm run sam:oracle:csi` may still fail only for the documented partial
  recording coverage/back-side sample blocker; new yaw/side/implausible gates
  must not be the failing reason.
