# VRM Rendering And Spring Bone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `assets/models/1406500396179985353.vrm` render as a visible skinned avatar and enable VRM spring-bone motion for hair and clothing while preserving the existing browser-first GLB path.

**Architecture:** Keep the current lightweight GLTF avatar path for Xbot, Soldier, and existing simple VRM candidates. Add a VRM-specific compatibility layer that sanitizes broken zero-alpha vertex colors, then add an optional `@pixiv/three-vrm` loader path for MToon/VRM0 compatibility and spring-bone updates. Run spring bones after pose retargeting and before rendering so source motion drives secondary hair/clothing response.

**Tech Stack:** Static browser app, Three.js `0.184.0`, `GLTFLoader`, optional `@pixiv/three-vrm@3.5.4`, Node-based contract checks, Playwright CLI browser smoke tests.

---

## Investigation Summary

Observed in the current workspace:

- `assets/models/1406500396179985353.vrm` loads successfully as VRM0.
- Browser status after upload: `Avatar: Ready`, `Bones: 448`.
- `window.motionTrackerDebug.getAvatarRigReport()` reports `ready: true`, `failed: false`, `humanoid.version: "vrm0"`, `requiredBones.missing: []`, and zero unresolved node mappings.
- With the avatar skeleton enabled, only the cyan skeleton is visible.
- With the skeleton disabled, only a near-black silhouette is visible.
- The model has 2 skinned mesh nodes, 42 primitives, 42 materials, 8 embedded PNG textures, 5 VRM0 `secondaryAnimation.boneGroups`, and no spring colliders.
- Every primitive has a `COLOR_0` vertex attribute. Sampled alpha is zero for all 42 primitives. With Three.js raw `GLTFLoader`, vertex alpha plus `alphaMode: "MASK"` can discard the mesh while the `SkeletonHelper` still renders.
- Existing repo docs explicitly say MToon and SpringBone are outside the current scope, so spring motion is absent by design, not because the model lacks spring metadata.
- Static compatibility warning: this model is heavy for the current browser budget: 16.1 MB, 1,140,062 counted vertices, and 451 non-mesh nodes/bones. Use `VRMUtils.removeUnnecessaryVertices()` and `VRMUtils.combineSkeletons()` in the VRM path before treating this as production-ready.

## File Structure

- Modify `index.html`
  - Add `@pixiv/three-vrm` import map entry pinned to `3.5.4`.
  - Bump the `src/app.js` cache key after runtime imports change.
- Create `src/vrm-rendering-compat.js`
  - Pure duck-typed helpers for zero-alpha vertex color detection, material sanitization, and VRM render diagnostics.
  - No `three` import so Node tests can run dependency-free.
- Modify `src/avatar-renderer.js`
  - Register `VRMLoaderPlugin` for VRM-capable loads.
  - Track `activeVrm`, spring-bone enable state, and VRM render diagnostics.
  - Use `VRMUtils.rotateVRM0()` only when the plugin produced a VRM instance; keep the existing `recommendedModelYawRad` fallback for raw GLTF loads.
  - Update VRM runtime components in the render loop after retargeting state is current and before `renderer.render()`. Do not call the aggregate `VRM.update(deltaSeconds)` because its expression manager clears morph targets owned by the app's face-expression path.
- Modify `src/app.js`
  - Expose debug APIs for VRM runtime diagnostics and spring-bone toggling.
- Modify `scripts/avatar-vrm-performance-check.mjs`
  - Report `colorPrimitiveCount`, `zeroAlphaColorPrimitiveCount`, `secondaryAnimationBoneGroupCount`, `secondaryAnimationSpringRootCount`, and `colliderGroupCount`.
- Create `tests/avatar-vrm-rendering-compat-check.mjs`
  - Unit-test zero-alpha vertex-color detection and material sanitization.
- Modify `tests/contract-check.mjs`
  - Enforce the import map entry and the renderer's VRM plugin/update contracts.
- Modify `package.json`
  - Add `node tests/avatar-vrm-rendering-compat-check.mjs` to `npm run check`.
- Modify `docs/avatar-model-validation.md`
  - Replace the old "MToon/SpringBone outside scope" note with the new opt-in VRM runtime behavior, limitations, and validation commands.
- Modify `README.md`
  - Update the avatar feature summary and debugging guidance.

---

### Task 1: Add Dependency-Free VRM Rendering Compatibility Tests

**Files:**
- Create: `tests/avatar-vrm-rendering-compat-check.mjs`
- Create: `src/vrm-rendering-compat.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing helper test**

Create `tests/avatar-vrm-rendering-compat-check.mjs`:

```js
import {
  describeVertexColorAlpha,
  sanitizeZeroAlphaVertexColors,
} from "../src/vrm-rendering-compat.js";

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function rootWith(mesh) {
  return {
    traverse(callback) {
      callback(mesh);
    },
  };
}

function colorAttribute(values) {
  return {
    itemSize: 4,
    count: values.length / 4,
    array: new Float32Array(values),
  };
}

const zeroAlphaColor = colorAttribute([
  1, 0, 0, 0,
  0.5, 0.25, 0, 0,
  0, 0.2, 0, 0,
]);
const usefulAlphaColor = colorAttribute([
  1, 1, 1, 1,
  0.5, 0.5, 0.5, 0.75,
]);

const zeroReport = describeVertexColorAlpha(zeroAlphaColor);
check(zeroReport.hasAlpha === true, "VEC4 color attributes should report alpha support");
check(zeroReport.maxAlpha === 0, "zero-alpha COLOR_0 should report maxAlpha 0");
check(zeroReport.allAlphaZero === true, "zero-alpha COLOR_0 should be classified");

const usefulReport = describeVertexColorAlpha(usefulAlphaColor);
check(usefulReport.allAlphaZero === false, "nonzero alpha COLOR_0 should not be sanitized");

const materialA = { vertexColors: true, needsUpdate: false };
const materialB = { vertexColors: true, needsUpdate: false };
const mesh = {
  isMesh: true,
  name: "U_Char_0",
  geometry: {
    attributes: {
      color: zeroAlphaColor,
    },
  },
  material: [materialA, materialB],
};

const sanitizeReport = sanitizeZeroAlphaVertexColors(rootWith(mesh));
check(sanitizeReport.meshesChecked === 1, "sanitizer should inspect mesh color attributes");
check(sanitizeReport.sanitizedMeshes === 1, "zero-alpha mesh should be sanitized");
check(sanitizeReport.sanitizedMaterials === 2, "all mesh materials should be sanitized");
check(materialA.vertexColors === false, "sanitized material should disable vertexColors");
check(materialB.vertexColors === false, "sanitized material array entries should disable vertexColors");
check(materialA.needsUpdate === true, "sanitized material should request shader update");

const safeMaterial = { vertexColors: true, needsUpdate: false };
const safeMesh = {
  isMesh: true,
  geometry: {
    attributes: {
      color: usefulAlphaColor,
    },
  },
  material: safeMaterial,
};
const safeReport = sanitizeZeroAlphaVertexColors(rootWith(safeMesh));
check(safeReport.sanitizedMeshes === 0, "nonzero alpha mesh should not be sanitized");
check(safeMaterial.vertexColors === true, "safe material should keep vertex colors");
check(safeMaterial.needsUpdate === false, "safe material should not be updated");

if (failures.length > 0) {
  console.error(`VRM rendering compatibility check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("VRM rendering compatibility check passed.");
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
node tests/avatar-vrm-rendering-compat-check.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../src/vrm-rendering-compat.js
```

- [ ] **Step 3: Implement the compatibility helper**

Create `src/vrm-rendering-compat.js`:

```js
const ZERO_ALPHA_EPSILON = 1e-6;

export function describeVertexColorAlpha(attribute) {
  if (!attribute || Number(attribute.itemSize) < 4 || !Number.isFinite(attribute.count)) {
    return {
      hasAlpha: false,
      count: 0,
      minAlpha: null,
      maxAlpha: null,
      allAlphaZero: false,
    };
  }

  let minAlpha = Infinity;
  let maxAlpha = -Infinity;

  for (let index = 0; index < attribute.count; index += 1) {
    const alpha = readColorAlpha(attribute, index);
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
  }

  return {
    hasAlpha: true,
    count: attribute.count,
    minAlpha,
    maxAlpha,
    allAlphaZero: maxAlpha <= ZERO_ALPHA_EPSILON,
  };
}

export function sanitizeZeroAlphaVertexColors(root) {
  const report = {
    meshesChecked: 0,
    sanitizedMeshes: 0,
    sanitizedMaterials: 0,
    sanitizedMeshNames: [],
  };

  root?.traverse?.((object) => {
    if (!object?.isMesh) {
      return;
    }

    const colorAttribute = object.geometry?.attributes?.color;
    const alphaReport = describeVertexColorAlpha(colorAttribute);

    if (!alphaReport.hasAlpha) {
      return;
    }

    report.meshesChecked += 1;

    if (!alphaReport.allAlphaZero) {
      return;
    }

    let sanitizedMaterials = 0;

    for (const material of materialList(object.material)) {
      if (!material || material.vertexColors === false) {
        continue;
      }

      material.vertexColors = false;
      material.needsUpdate = true;
      sanitizedMaterials += 1;
    }

    if (sanitizedMaterials > 0) {
      report.sanitizedMeshes += 1;
      report.sanitizedMaterials += sanitizedMaterials;
      report.sanitizedMeshNames.push(object.name || "(unnamed mesh)");
    }
  });

  return report;
}

function readColorAlpha(attribute, index) {
  if (typeof attribute.getW === "function") {
    return Number(attribute.getW(index)) || 0;
  }

  const array = attribute.array;
  const offset = index * attribute.itemSize + 3;
  return Number(array?.[offset]) || 0;
}

function materialList(material) {
  if (Array.isArray(material)) {
    return material;
  }

  return material ? [material] : [];
}
```

- [ ] **Step 4: Add the test to `npm run check`**

Modify `package.json` so the `check` script starts with:

```json
"check": "node tests/contract-check.mjs && node tests/avatar-vrm-rendering-compat-check.mjs && node tests/avatar-vrm-humanoid-check.mjs && node tests/avatar-vrm-expression-check.mjs && node tests/retarget-orientation-check.mjs && node tests/strict-retarget-check.mjs && node tests/depth-calibration-check.mjs && node tests/motion-frame-check.mjs && node tests/motion-forwarding-check.mjs && node tests/presence-state-check.mjs && node tests/facing-estimator-check.mjs && node tests/solver-synthetic-check.mjs && node tests/sam-manual-labels-check.mjs && node tests/motion-recording-compare-check.mjs && node tests/retarget-mode-compare-check.mjs && node tests/mhr70-mapping-check.mjs && node tests/mhr70-hands-check.mjs && node tests/gesture-classifier-check.mjs && node tests/sam-reference-labeler-check.mjs && node tests/sam-calibration-profile-check.mjs && node tests/sam-regression-oracle-check.mjs && node tests/hmr-jsonl-adapter-check.mjs && node tests/clip-manifest-check.mjs"
```

- [ ] **Step 5: Run the targeted test**

Run:

```bash
node tests/avatar-vrm-rendering-compat-check.mjs
```

Expected:

```text
VRM rendering compatibility check passed.
```

### Task 2: Fix Raw GLTF VRM Visibility Without Changing Retargeting

**Files:**
- Modify: `src/avatar-renderer.js`
- Modify: `tests/contract-check.mjs`

- [ ] **Step 1: Import the compatibility helper**

Modify the import block in `src/avatar-renderer.js`:

```js
import {
  describeVertexColorAlpha,
  sanitizeZeroAlphaVertexColors,
} from './vrm-rendering-compat.js';
```

- [ ] **Step 2: Add render compatibility diagnostics state**

Near `const modelDiagnostics = { unresolvedNodeMappings: [] };`, replace it with:

```js
  const modelDiagnostics = {
    unresolvedNodeMappings: [],
    renderCompatibility: null,
  };
```

In `dispose()` and `fail()`, reset:

```js
    modelDiagnostics.renderCompatibility = null;
```

- [ ] **Step 3: Sanitize zero-alpha vertex colors after mesh setup**

In `loadModel()`, immediately after the existing `model.traverse((object) => { ... })` block, add:

```js
    modelDiagnostics.renderCompatibility = sanitizeZeroAlphaVertexColors(model);
```

Keep this before `await cacheVrmExpressionMapping(gltf);` so morph/expression resolution sees the final material state.

- [ ] **Step 4: Expose diagnostics**

In `getModelDiagnostics()`, add this field beside `unresolvedNodeMappings`:

```js
      renderCompatibility: modelDiagnostics.renderCompatibility,
```

- [ ] **Step 5: Add contract coverage**

In `tests/contract-check.mjs`, add `vrmRenderingCompat` to `files`:

```js
  vrmRenderingCompat: "src/vrm-rendering-compat.js",
```

Read it with the existing source-loading pattern and add checks:

```js
checkPattern(
  avatarRendererSource,
  /sanitizeZeroAlphaVertexColors/,
  "avatar renderer must sanitize zero-alpha VRM vertex colors before rendering",
);
checkPattern(
  avatarRendererSource,
  /renderCompatibility/,
  "avatar rig diagnostics must expose VRM render compatibility state",
);
checkPattern(
  vrmRenderingCompatSource,
  /describeVertexColorAlpha/,
  "VRM rendering compatibility helper must expose alpha diagnostics",
);
```

- [ ] **Step 6: Verify static checks**

Run:

```bash
npm run check
```

Expected:

```text
Avatar VRM rendering compatibility check passed.
...
```

The full command should exit `0`.

- [ ] **Step 7: Verify browser visibility manually**

Run:

```bash
npm run start
```

Open:

```text
http://127.0.0.1:8000/
```

Upload:

```text
assets/models/1406500396179985353.vrm
```

In the browser console, run:

```js
window.motionTrackerDebug.getAvatarRigReport().renderCompatibility
```

Expected shape:

```js
{
  meshesChecked: 2,
  sanitizedMeshes: 2,
  sanitizedMaterials: 2,
  sanitizedMeshNames: ["U_Char_0", "U_Char_1"]
}
```

The exact material count can differ if Three creates one material per primitive. The acceptance condition is `sanitizedMeshes > 0` and the model is visibly textured with the **Avatar skeleton** toggle off.

### Task 3: Add Optional `@pixiv/three-vrm` Loader Path

**Files:**
- Modify: `index.html`
- Modify: `src/avatar-renderer.js`
- Modify: `tests/contract-check.mjs`

- [ ] **Step 1: Add import map entry**

Modify the import map in `index.html`:

```json
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/",
    "@pixiv/three-vrm": "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.5.4/lib/three-vrm.module.js"
  }
}
```

Bump the app script query:

```html
<script type="module" src="./src/app.js?v=20260704-vrm-runtime-1"></script>
```

- [ ] **Step 2: Import VRM runtime APIs**

In `src/avatar-renderer.js`, add:

```js
import {
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm';
```

- [ ] **Step 3: Track active VRM runtime state**

Near `let loadedGltf = null;`, add:

```js
  let activeVrm = null;
  let activeVrmRuntime = {
    available: false,
    version: null,
    springBoneEnabled: true,
    springBoneJointCount: 0,
    colliderCount: 0,
    colliderGroupCount: 0,
    lastUpdateDeltaSec: 0,
  };
```

- [ ] **Step 4: Register the loader plugin**

At the start of `loadModel()` replace:

```js
    const loader = new GLTFLoader();
```

with:

```js
    const loader = new GLTFLoader();

    loader.register((parser) => new VRMLoaderPlugin(parser));
```

- [ ] **Step 5: Use `gltf.userData.vrm` when present**

Keep the existing humanoid parsing before the runtime state is built:

```js
    loadedGltf = gltf;
    vrmHumanoid = parseVrmHumanoid(gltf.parser?.json);
    vrmHumanoidMapping = createVrmHumanoidMapping(vrmHumanoid);
    modelDiagnostics.unresolvedNodeMappings = [];
    activeModelKind = detectAvatarModelKind(gltf);
    activeModelProfile = HEAD_NECK_PROFILE_DEFAULTS[activeModelKind] ?? HEAD_NECK_PROFILE_DEFAULTS.default;
```

Immediately after that block, add:

```js
    activeVrm = gltf.userData?.vrm ?? null;

    if (activeVrm) {
      VRMUtils.rotateVRM0(activeVrm);
      VRMUtils.removeUnnecessaryVertices(activeVrm.scene);
      VRMUtils.combineSkeletons(activeVrm.scene);
      model = activeVrm.scene;
      activeVrmRuntime = {
        available: true,
        version: vrmHumanoid?.version ?? null,
        springBoneEnabled: true,
        springBoneJointCount: activeVrm.springBoneManager?.joints?.size ?? 0,
        colliderCount: activeVrm.springBoneManager?.colliders?.length ?? 0,
        colliderGroupCount: activeVrm.springBoneManager?.colliderGroups?.length ?? 0,
        lastUpdateDeltaSec: 0,
      };
    } else {
      model = gltf.scene;
      activeVrmRuntime = {
        available: false,
        version: null,
        springBoneEnabled: false,
        springBoneJointCount: 0,
        colliderCount: 0,
        colliderGroupCount: 0,
        lastUpdateDeltaSec: 0,
      };
    }
```

Then remove the existing later duplicate line:

```js
    model = gltf.scene;
```

- [ ] **Step 6: Avoid double VRM0 rotation**

Replace the current `initialYaw` block with:

```js
    const initialYaw = activeVrm
      ? 0
      : vrmHumanoid
        ? vrmHumanoid.recommendedModelYawRad ?? 0
        : getNonVrmInitialModelYawRad();
```

- [ ] **Step 7: Preserve existing bone and expression behavior**

Do not replace `parseVrmHumanoid()`, `createVrmHumanoidMapping()`, `cacheVrmExpressionMapping()`, or the existing retarget code in this task. The plugin is used for material, VRM0 compatibility, spring data, and optimization; the repo's current retargeting contract remains unchanged.

- [ ] **Step 8: Dispose active VRM state**

In `dispose()` and `fail()`, clear:

```js
    activeVrm = null;
    activeVrmRuntime = {
      available: false,
      version: null,
      springBoneEnabled: false,
      springBoneJointCount: 0,
      colliderCount: 0,
      colliderGroupCount: 0,
      lastUpdateDeltaSec: 0,
    };
```

- [ ] **Step 9: Add contract checks**

In `tests/contract-check.mjs`, add:

```js
check(
  importMap?.imports?.["@pixiv/three-vrm"] === "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.5.4/lib/three-vrm.module.js",
  "index.html import map must pin @pixiv/three-vrm to 3.5.4",
);
checkPattern(
  avatarRendererSource,
  /new VRMLoaderPlugin\(parser\)/,
  "avatar renderer must register VRMLoaderPlugin",
);
checkPattern(
  avatarRendererSource,
  /VRMUtils\.removeUnnecessaryVertices/,
  "avatar renderer must remove unused VRM vertices in the VRM path",
);
checkPattern(
  avatarRendererSource,
  /VRMUtils\.combineSkeletons/,
  "avatar renderer must combine VRM skeletons in the VRM path",
);
```

- [ ] **Step 10: Verify static checks**

Run:

```bash
npm run check
```

Expected: exit `0`.

### Task 4: Enable Spring-Bone Runtime Updates

**Files:**
- Modify: `src/avatar-renderer.js`
- Modify: `src/app.js`
- Modify: `tests/contract-check.mjs`

- [ ] **Step 1: Add render-loop VRM timing state**

In `src/avatar-renderer.js`, near `let lastUpdateTime = 0;`, add:

```js
  let lastVrmRenderUpdateTime = 0;
```

- [ ] **Step 2: Add spring-bone update helper**

Add this function near the render loop:

```js
  function updateVrmRuntimeBeforeRender(timestampMs) {
    if (!activeVrm || activeVrmRuntime.runtimeUpdateFailed) {
      lastVrmRenderUpdateTime = timestampMs;
      return;
    }

    const previous = lastVrmRenderUpdateTime || timestampMs;
    const deltaSec = Math.min(Math.max((timestampMs - previous) / 1000, 0), 1 / 15);

    lastVrmRenderUpdateTime = timestampMs;
    activeVrmRuntime.lastUpdateDeltaSec = deltaSec;

    if (deltaSec <= 0) {
      return;
    }

    try {
      updateActiveVrmRuntime(deltaSec);
      activeVrmRuntime.updateError = null;
    } catch (error) {
      activeVrmRuntime.runtimeUpdateFailed = true;
      activeVrmRuntime.updateError = error instanceof Error ? error.message : String(error);
      console.warn('VRM runtime update skipped', error);
    }
  }

  function updateActiveVrmRuntime(deltaSec) {
    // Expression morph targets are app-owned via applyVrmExpressionScores().
    // Calling the aggregate three-vrm update would clear those influences.
    activeVrm.humanoid?.update?.();
    activeVrm.lookAt?.update?.(deltaSec);
    activeVrm.nodeConstraintManager?.update?.();

    if (activeVrmRuntime.springBoneEnabled) {
      activeVrm.springBoneManager?.update?.(deltaSec);
    }

    for (const material of activeVrm.materials ?? []) {
      material?.update?.(deltaSec);
    }
  }
```

- [ ] **Step 3: Call spring-bone update before rendering**

Replace the render callback body:

```js
    const render = () => {
      animationFrameId = requestAnimationFrame(render);
      resize();
      const startedAt = nowMs();
      renderer.render(scene, camera);
      recordPerformanceSample(performanceStats.renderMs, nowMs() - startedAt);
    };
```

with:

```js
    const render = (timestampMs = nowMs()) => {
      animationFrameId = requestAnimationFrame(render);
      resize();
      const startedAt = nowMs();
      updateVrmRuntimeBeforeRender(timestampMs);
      renderer.render(scene, camera);
      recordPerformanceSample(performanceStats.renderMs, nowMs() - startedAt);
    };
```

- [ ] **Step 4: Reset spring state on pose reset**

In `resetPose()`, after `restoreRestPose(1);`, add:

```js
    activeVrm?.springBoneManager?.setInitState?.();
    activeVrm?.springBoneManager?.reset?.();
    lastVrmRenderUpdateTime = 0;
```

- [ ] **Step 5: Expose renderer API**

Add to the returned `api` object:

```js
    getVrmRuntimeReport,
    setVrmSpringBoneEnabled,
```

Add functions near other getters/setters:

```js
  function getVrmRuntimeReport() {
    return {
      ...activeVrmRuntime,
      springBoneEnabled: Boolean(activeVrmRuntime.springBoneEnabled),
    };
  }

  function setVrmSpringBoneEnabled(value) {
    if (!activeVrm) {
      return getVrmRuntimeReport();
    }

    activeVrmRuntime.springBoneEnabled = Boolean(value);
    activeVrmRuntime.lastUpdateDeltaSec = 0;
    activeVrmRuntime.runtimeUpdateFailed = false;
    activeVrmRuntime.updateError = null;
    lastVrmRenderUpdateTime = 0;
    activeVrm?.springBoneManager?.setInitState?.();
    activeVrm?.springBoneManager?.reset?.();

    return getVrmRuntimeReport();
  }
```

- [ ] **Step 6: Expose app debug API**

In `src/app.js` inside `motionTrackerDebug`, add:

```js
    getVrmRuntimeReport: () => state.avatarRenderer?.getVrmRuntimeReport?.() ?? null,
    setVrmSpringBoneEnabled: (value) => state.avatarRenderer?.setVrmSpringBoneEnabled?.(value) ?? null,
```

- [ ] **Step 7: Add contract checks**

In `tests/contract-check.mjs`, add:

```js
checkPattern(
  avatarRendererSource,
  /activeVrm\.springBoneManager\?\.\s*update\?\.\s*\(\s*deltaSec\s*\)/,
  "avatar renderer must update VRM spring bones in the render loop",
);
check(
  !/activeVrm\.update\s*\(/.test(avatarRendererSource),
  "avatar renderer must not call aggregate activeVrm.update() because it clears app-owned expression morph targets",
);
checkPattern(
  appSource,
  /getVrmRuntimeReport/,
  "debug API must expose VRM runtime diagnostics",
);
checkPattern(
  appSource,
  /setVrmSpringBoneEnabled/,
  "debug API must expose VRM spring-bone toggle",
);
```

- [ ] **Step 8: Verify static checks**

Run:

```bash
npm run check
```

Expected: exit `0`.

### Task 5: Extend VRM Asset Diagnostics

**Files:**
- Modify: `scripts/avatar-vrm-performance-check.mjs`

- [ ] **Step 1: Return the GLB binary chunk from the parser**

Replace `parseGlbJson(buffer, label)` with a parser that returns both JSON and BIN:

```js
function parseGlb(buffer, label) {
  check(buffer.length >= 20, `${label}: expected a non-empty GLB/VRM file`);

  const magic = buffer.toString("utf8", 0, 4);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);

  check(magic === "glTF", `${label}: expected glTF binary magic`);
  check(version === 2, `${label}: expected glTF 2.0 binary`);
  check(declaredLength === buffer.length, `${label}: declared length must match file size`);

  let offset = 12;
  let json = null;
  let binChunk = null;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    offset += 8;

    if (chunkType === "JSON") {
      json = JSON.parse(
        buffer
          .toString("utf8", offset, offset + chunkLength)
          .replace(/\u0000+$/g, "")
          .trim(),
      );
    } else if (chunkType === "BIN\0") {
      binChunk = buffer.subarray(offset, offset + chunkLength);
    }

    offset += chunkLength;
  }

  if (!json) {
    throw new Error(`${label}: missing JSON chunk`);
  }

  return { json, binChunk };
}
```

Update the call site:

```js
const { json, binChunk } = parseGlb(modelBytes, modelPath);
```

- [ ] **Step 2: Add static metadata helpers**

Add below `countVertices(json)`:

```js
const ACCESSOR_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};
const COMPONENT_BYTE_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

function primitiveList(json) {
  return (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
}

function countColorPrimitives(json) {
  return primitiveList(json).filter((primitive) => Number.isInteger(primitive.attributes?.COLOR_0)).length;
}

function countZeroAlphaColorPrimitivesFromBin(json, binChunk) {
  const alphaMaxByAccessor = new Map();

  return primitiveList(json).filter((primitive) => {
    const accessorIndex = primitive.attributes?.COLOR_0;

    if (!Number.isInteger(accessorIndex)) {
      return false;
    }

    if (!alphaMaxByAccessor.has(accessorIndex)) {
      alphaMaxByAccessor.set(accessorIndex, readColorAccessorMaxAlpha(json, binChunk, accessorIndex));
    }

    return (alphaMaxByAccessor.get(accessorIndex) ?? 1) <= 1e-6;
  }).length;
}

function readColorAccessorMaxAlpha(json, binChunk, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex];
  const bufferView = json.bufferViews?.[accessor?.bufferView];

  if (!binChunk || !accessor || !bufferView || accessor.type !== "VEC4") {
    return null;
  }

  const componentSize = COMPONENT_BYTE_SIZE[accessor.componentType];
  const componentCount = ACCESSOR_COMPONENTS[accessor.type];
  const stride = bufferView.byteStride ?? componentSize * componentCount;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binChunk.buffer, binChunk.byteOffset, binChunk.byteLength);
  let maxAlpha = -Infinity;

  for (let index = 0; index < accessor.count; index += 1) {
    const alphaOffset = start + index * stride + componentSize * 3;
    const alpha = readAccessorComponent(dataView, alphaOffset, accessor.componentType, accessor.normalized);
    maxAlpha = Math.max(maxAlpha, alpha);
  }

  return maxAlpha;
}

function readAccessorComponent(dataView, byteOffset, componentType, normalized) {
  let value = 0;

  if (componentType === 5120) {
    value = dataView.getInt8(byteOffset);
  } else if (componentType === 5121) {
    value = dataView.getUint8(byteOffset);
  } else if (componentType === 5122) {
    value = dataView.getInt16(byteOffset, true);
  } else if (componentType === 5123) {
    value = dataView.getUint16(byteOffset, true);
  } else if (componentType === 5125) {
    value = dataView.getUint32(byteOffset, true);
  } else if (componentType === 5126) {
    value = dataView.getFloat32(byteOffset, true);
  }

  if (!normalized) {
    return value;
  }

  if (componentType === 5120) {
    return Math.max(value / 127, -1);
  }

  if (componentType === 5121) {
    return value / 255;
  }

  if (componentType === 5122) {
    return Math.max(value / 32767, -1);
  }

  if (componentType === 5123) {
    return value / 65535;
  }

  return value;
}

function secondaryAnimationSummary(json) {
  const secondary = json.extensions?.VRM?.secondaryAnimation;
  const boneGroups = secondary?.boneGroups ?? [];

  return {
    boneGroupCount: boneGroups.length,
    springRootCount: boneGroups.reduce((total, group) => total + (group.bones?.length ?? 0), 0),
    colliderGroupCount: secondary?.colliderGroups?.length ?? 0,
    gravityGroupCount: boneGroups.filter((group) => Number(group.gravityPower) > 0).length,
  };
}
```

- [ ] **Step 3: Include fields in the report**

Before `const report = { ... }`, add:

```js
const secondaryAnimation = secondaryAnimationSummary(json);
```

In the report object, add:

```js
  colorPrimitives: countColorPrimitives(json),
  zeroAlphaColorPrimitives: countZeroAlphaColorPrimitivesFromBin(json, binChunk),
  secondaryAnimation,
```

- [ ] **Step 4: Run diagnostics on the problem model**

Run:

```bash
node scripts/avatar-vrm-performance-check.mjs assets/models/1406500396179985353.vrm
```

Expected important fields:

```json
{
  "colorPrimitives": 42,
  "zeroAlphaColorPrimitives": 42,
  "secondaryAnimation": {
    "boneGroupCount": 5,
    "springRootCount": 274,
    "colliderGroupCount": 0,
    "gravityGroupCount": 1
  }
}
```

### Task 6: Browser And Motion Validation

**Files:**
- No new source files.
- Artifacts: `output/reports/vrm-1406500396179985353-motion.json`, `.playwright-cli/element-*.png`

- [ ] **Step 1: Run full static checks**

Run:

```bash
npm run check
```

Expected: exit `0`.

- [ ] **Step 2: Run targeted VRM asset diagnostics**

Run:

```bash
node scripts/avatar-vrm-performance-check.mjs assets/models/1406500396179985353.vrm
```

Expected:

```text
Avatar VRM compatibility check passed.
```

Warnings about size, vertex count, and bone/node count are acceptable for this model unless `--enforce-budget` is explicitly passed.

- [ ] **Step 3: Start static server**

Run:

```bash
npm run start
```

Expected:

```text
Serving HTTP on 127.0.0.1 port 8000
```

- [ ] **Step 4: Verify HTTP availability**

Run in another terminal:

```bash
curl -I http://127.0.0.1:8000/
curl -I http://127.0.0.1:8000/assets/models/1406500396179985353.vrm
```

Expected: both return HTTP `200`.

- [ ] **Step 5: Browser visual smoke**

Use Playwright CLI:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open http://127.0.0.1:8000/ --headed
"$PWCLI" snapshot
"$PWCLI" click e52
"$PWCLI" upload /Users/chasoik/Projects/action-tracker/assets/models/1406500396179985353.vrm
"$PWCLI" uncheck e58
"$PWCLI" screenshot e23
```

Expected:

- Avatar status remains `Ready`.
- Bone count remains high, near `448`.
- With `Avatar skeleton` unchecked, the textured character is visible, not a black silhouette.

- [ ] **Step 6: Browser runtime diagnostics**

In Playwright:

```bash
"$PWCLI" eval "() => JSON.stringify({ rig: window.motionTrackerDebug.getAvatarRigReport(), vrm: window.motionTrackerDebug.getVrmRuntimeReport() }, null, 2)"
```

Expected conditions:

```js
result.rig.ready === true
result.rig.requiredBones.missing.length === 0
result.rig.renderCompatibility.sanitizedMeshes > 0
result.vrm.available === true
result.vrm.springBoneJointCount > 0
result.vrm.springBoneEnabled === true
```

- [ ] **Step 7: Run sample-video motion gate for the problem VRM**

Run:

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --only-models \
  --model "VRM140=assets/models/1406500396179985353.vrm" \
  --delegate cpu \
  --debug-overlay off \
  --min-pose-frames 180 \
  --warmup-pose-frames 60 \
  --output output/reports/vrm-1406500396179985353-motion.json
```

Expected:

- Avatar reaches `Ready`.
- Runtime does not fail due shader compile or skinning.
- `render.p95Ms <= 14` remains the target. If this model exceeds the target, keep the implementation but document the model as heavy and use it as a manual compatibility case, not a default CI gate.

### Task 7: Documentation Updates

**Files:**
- Modify: `README.md`
- Modify: `docs/avatar-model-validation.md`

- [ ] **Step 1: Update README avatar scope**

Replace the sentence that says the project intentionally does not include MToon/SpringBone behavior with:

```md
The default path remains browser-first and dependency-light for GLB models. VRM uploads use a pinned `@pixiv/three-vrm` loader path for VRM0 material compatibility, MToon rendering, and spring-bone updates when the model contains spring metadata. The app still does not add Electron, FBX loading, or a full VTuber studio product surface.
```

- [ ] **Step 2: Update VRM workflow docs**

In `docs/avatar-model-validation.md`, replace:

```md
- MToon rendering, SpringBone, and VRM constraint simulation are outside this
  motion-preview scope.
```

with:

```md
- VRM uploads now use the optional `@pixiv/three-vrm` runtime for VRM0 material compatibility, MToon rendering, geometry/skeleton optimization, and spring-bone updates. Spring motion depends on the model's own `secondaryAnimation`/spring metadata; models without spring groups will remain rigid unless authored with spring bones. Models without collider groups can still move, but hair or clothing may clip through the body during large motion.
```

- [ ] **Step 3: Add the problem-model diagnostic note**

Append to the VRM workflow section:

```md
For `assets/models/1406500396179985353.vrm`, raw GLTF loading exposes `COLOR_0` with zero alpha across all primitives, which can make the skinned mesh effectively disappear while the skeleton helper remains visible. The renderer sanitizes that case by disabling vertex colors on the affected meshes and reports the action through `window.motionTrackerDebug.getAvatarRigReport().renderCompatibility`.
```

- [ ] **Step 4: Run docs-adjacent checks**

Run:

```bash
npm run check
```

Expected: exit `0`.

## Self-Review

Spec coverage:

- Visible model bug: covered by Tasks 1, 2, 5, and 6.
- Hair/clothing spring motion: covered by Tasks 3, 4, and 6.
- Performance risk from this specific model: covered by Tasks 3, 5, and 6.
- Repo-native docs and validation: covered by Tasks 5, 6, and 7.

Placeholder scan:

- No `TBD`, `TODO`, or empty implementation steps remain.
- Each code-changing step includes concrete code or concrete replacement text.

Type consistency:

- `renderCompatibility` is introduced in renderer diagnostics and exposed through the existing rig report.
- `activeVrmRuntime`, `getVrmRuntimeReport()`, and `setVrmSpringBoneEnabled()` are used consistently across renderer and app debug APIs.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-07-04-vrm-rendering-springbone.md`.

1. Subagent-Driven (recommended) - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints.
