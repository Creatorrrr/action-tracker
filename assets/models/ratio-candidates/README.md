# Ratio-Matched Avatar Candidates

Downloaded candidate:

- `soldier.glb`
  - Name: Soldier
  - Format: GLB / glTF binary
  - Skeleton: Mixamo-style `mixamorig:*`
  - Source: https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb
  - License: MIT, via the three.js examples repository
  - Local license reference: `../threejs-LICENSE.txt`

Why this candidate:

- The default `Xbot.glb` has arm-to-torso ratio about `0.83` and leg-to-torso
  ratio about `1.19`.
- `soldier.glb` has arm-to-torso ratio about `0.78` and leg-to-torso ratio
  about `1.14`, so it should preserve more visible arm and leg motion than the
  short-limbed chibi VRM candidate.
- It uses a compatible Mixamo-style skeleton, so it avoids the VRM head/neck
  axis mismatch seen in several stylized candidates.
