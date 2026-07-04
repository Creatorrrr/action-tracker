export const VRM_EXPRESSION_PRESETS = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "happy",
  "angry",
  "sad",
  "surprised",
  "relaxed",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];

const VRM_EXPRESSION_PRESET_SET = new Set(VRM_EXPRESSION_PRESETS);
const PRESET_ALIASES = {
  blink: "blink",
  blinkleft: "blinkLeft",
  blinkl: "blinkLeft",
  blinkright: "blinkRight",
  blinkr: "blinkRight",
  aa: "aa",
  a: "aa",
  ih: "ih",
  i: "ih",
  ou: "ou",
  u: "ou",
  ee: "ee",
  e: "ee",
  oh: "oh",
  o: "oh",
  happy: "happy",
  joy: "happy",
  angry: "angry",
  sad: "sad",
  sorrow: "sad",
  surprised: "surprised",
  surprise: "surprised",
  relaxed: "relaxed",
  fun: "relaxed",
  lookup: "lookUp",
  lookdown: "lookDown",
  lookleft: "lookLeft",
  lookright: "lookRight",
};

const BLEND_SHAPE_ALIASES = {
  blinkLeft: ["eyeBlinkLeft", "blinkLeft"],
  blinkRight: ["eyeBlinkRight", "blinkRight"],
  aa: ["jawOpen", "mouthOpen", "viseme_aa", "visemeA", "aa", "a"],
  ih: ["mouthStretchLeft", "mouthStretchRight", "viseme_ih", "visemeI", "ih", "i"],
  ou: ["mouthPucker", "mouthFunnel", "viseme_ou", "visemeU", "ou", "u"],
  ee: ["mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "viseme_ee", "visemeE", "ee", "e"],
  oh: ["mouthFunnel", "jawOpen", "viseme_oh", "visemeO", "oh", "o"],
  happy: ["mouthSmileLeft", "mouthSmileRight", "cheekSquintLeft", "cheekSquintRight", "happy"],
  angry: ["browDownLeft", "browDownRight", "angry"],
  sad: ["mouthFrownLeft", "mouthFrownRight", "sad"],
  surprised: ["eyeWideLeft", "eyeWideRight", "jawOpen", "browInnerUp", "surprised"],
  relaxed: ["relaxed"],
  lookUp: ["eyeLookUpLeft", "eyeLookUpRight", "lookUp"],
  lookDown: ["eyeLookDownLeft", "eyeLookDownRight", "lookDown"],
  lookLeft: ["eyeLookOutLeft", "eyeLookInRight", "lookLeft"],
  lookRight: ["eyeLookInLeft", "eyeLookOutRight", "lookRight"],
};

const DEFAULT_EXPRESSION_RESPONSE = { gain: 1, deadband: 0 };
const EXPRESSION_RESPONSE_PROFILES = {
  blink: { gain: 1.16, deadband: 0.1 },
  blinkLeft: { gain: 1.16, deadband: 0.1 },
  blinkRight: { gain: 1.16, deadband: 0.1 },
  aa: { gain: 1, deadband: 0.05 },
  ih: { gain: 0.96, deadband: 0.06 },
  ou: { gain: 0.96, deadband: 0.06 },
  ee: { gain: 1, deadband: 0.06 },
  oh: { gain: 1, deadband: 0.06 },
  happy: { gain: 1.08, deadband: 0.08 },
  angry: { gain: 1.02, deadband: 0.08 },
  sad: { gain: 1.02, deadband: 0.08 },
  surprised: { gain: 1.04, deadband: 0.08 },
  relaxed: { gain: 0.9, deadband: 0.08 },
  lookUp: { gain: 0.95, deadband: 0.07 },
  lookDown: { gain: 0.95, deadband: 0.07 },
  lookLeft: { gain: 0.95, deadband: 0.07 },
  lookRight: { gain: 0.95, deadband: 0.07 },
};

export function parseVrmExpressionMetadata(json) {
  const vrm1Expressions = json?.extensions?.VRMC_vrm?.expressions?.preset;

  if (vrm1Expressions && typeof vrm1Expressions === "object") {
    return parseVrm1Expressions(vrm1Expressions);
  }

  const vrm0Groups = json?.extensions?.VRM?.blendShapeMaster?.blendShapeGroups;

  if (Array.isArray(vrm0Groups)) {
    return parseVrm0Expressions(vrm0Groups, buildMeshNodeIndex(json?.nodes));
  }

  return createExpressionMetadata(null);
}

export async function resolveVrmExpressionTargets(metadata, options = {}) {
  const mapping = {
    version: metadata?.version ?? null,
    presets: {},
    targets: [],
    expressionPresetCount: 0,
    resolvedMorphTargetCount: 0,
    missingPresets: VRM_EXPRESSION_PRESETS.slice(),
    unresolvedBindings: [],
  };
  const getNodeObject = options.getNodeObject ?? (async () => null);
  const targetByKey = new Map();

  for (const [preset, expression] of Object.entries(metadata?.presets ?? {})) {
    const resolvedBinds = [];

    for (const bind of expression.binds ?? []) {
      const nodeObject = Number.isInteger(bind.nodeIndex)
        ? await getNodeObject(bind.nodeIndex)
        : bind.target ?? null;
      const target = findMorphTargetObject(nodeObject, bind.index);

      if (!target) {
        mapping.unresolvedBindings.push({
          preset,
          sourceName: expression.sourceName,
          nodeIndex: bind.nodeIndex ?? null,
          meshIndex: bind.meshIndex ?? null,
          index: bind.index,
          reason: "morph target not found",
        });
        continue;
      }

      const key = targetKey(target, bind.index);
      const targetRecord = getOrCreateTargetRecord(targetByKey, mapping.targets, target, bind.index, key);
      resolvedBinds.push({
        target,
        index: bind.index,
        weight: bind.weight,
        key,
        restInfluence: targetRecord.restInfluence,
        sourceName: expression.sourceName,
      });
    }

    if (resolvedBinds.length > 0) {
      mapping.presets[preset] = {
        name: preset,
        sourceName: expression.sourceName,
        binds: resolvedBinds,
      };
    }
  }

  mapping.expressionPresetCount = Object.keys(mapping.presets).length;
  mapping.resolvedMorphTargetCount = mapping.targets.length;
  mapping.missingPresets = VRM_EXPRESSION_PRESETS.filter((preset) => !mapping.presets[preset]);
  return mapping;
}

export function mapMediaPipeBlendShapesToVrmPresets(blendShapes) {
  const source = createBlendShapeScoreMap(blendShapes);
  const blinkLeft = weightedMax(source, [{ name: "eyeBlinkLeft" }, { name: "blinkLeft" }]);
  const blinkRight = weightedMax(source, [{ name: "eyeBlinkRight" }, { name: "blinkRight" }]);
  const scores = {
    blink: Math.max(blinkLeft, blinkRight),
    blinkLeft,
    blinkRight,
    aa: weightedMax(source, [{ name: "jawOpen" }, { name: "mouthOpen" }, { name: "viseme_aa" }, { name: "visemeA" }, { name: "aa" }, { name: "a" }]),
    ih: weightedMax(source, aliasEntries("ih")),
    ou: weightedMax(source, aliasEntries("ou")),
    ee: weightedMax(source, aliasEntries("ee")),
    oh: weightedMax(source, [
      { name: "mouthFunnel" },
      { name: "jawOpen", weight: 0.55 },
      { name: "viseme_oh" },
      { name: "visemeO" },
      { name: "oh" },
      { name: "o" },
    ]),
    happy: weightedMax(source, aliasEntries("happy")),
    angry: weightedMax(source, aliasEntries("angry")),
    sad: weightedMax(source, aliasEntries("sad")),
    surprised: weightedMax(source, [
      { name: "eyeWideLeft" },
      { name: "eyeWideRight" },
      { name: "jawOpen", weight: 0.65 },
      { name: "browInnerUp" },
      { name: "surprised" },
    ]),
    relaxed: weightedMax(source, aliasEntries("relaxed")),
    lookUp: weightedMax(source, aliasEntries("lookUp")),
    lookDown: weightedMax(source, aliasEntries("lookDown")),
    lookLeft: weightedMax(source, aliasEntries("lookLeft")),
    lookRight: weightedMax(source, aliasEntries("lookRight")),
  };

  return Object.fromEntries(
    Object.entries(scores)
      .map(([preset, score]) => [preset, shapeExpressionScore(preset, score)])
      .filter(([, score]) => Number.isFinite(score) && score > 0),
  );
}

export function applyVrmExpressionScores(mapping, targetScores = {}, previousScores = {}, alpha = 1) {
  const presets = mapping?.presets ?? {};
  const nextScores = {};
  const contributions = new Map();

  for (const [preset, expression] of Object.entries(presets)) {
    const previous = clamp01(Number(previousScores?.[preset] ?? 0));
    const target = clamp01(Number(targetScores?.[preset] ?? 0));
    const smoothAlpha = resolveExpressionAlpha(alpha, preset);
    const score = previous + (target - previous) * smoothAlpha;
    nextScores[preset] = score;

    if (score <= 0.0001) {
      continue;
    }

    for (const bind of expression.binds ?? []) {
      const contribution = score * bind.weight;
      contributions.set(bind.key, (contributions.get(bind.key) ?? 0) + contribution);
    }
  }

  for (const target of mapping?.targets ?? []) {
    if (Array.isArray(target.mesh?.morphTargetInfluences)) {
      target.mesh.morphTargetInfluences[target.index] = clamp01(
        target.restInfluence + (contributions.get(target.key) ?? 0),
      );
    }
  }

  return nextScores;
}

function shapeExpressionScore(preset, score) {
  const normalizedScore = clamp01(Number(score));
  const response = EXPRESSION_RESPONSE_PROFILES[preset] ?? DEFAULT_EXPRESSION_RESPONSE;
  const deadband = clamp01(Number(response.deadband ?? 0));

  if (!Number.isFinite(normalizedScore) || normalizedScore <= deadband) {
    return 0;
  }

  const scaled = (normalizedScore - deadband) / Math.max(1 - deadband, Number.EPSILON);
  return clamp01(scaled * Number(response.gain ?? 1));
}

function resolveExpressionAlpha(alpha, preset) {
  if (alpha && typeof alpha === "object") {
    return clamp01(Number(alpha[preset] ?? alpha.default ?? 1));
  }

  return clamp01(Number(alpha ?? 1));
}

export function summarizeVrmExpressionMapping(mapping) {
  return {
    version: mapping?.version ?? null,
    expressionPresetCount: mapping?.expressionPresetCount ?? Object.keys(mapping?.presets ?? {}).length,
    resolvedMorphTargetCount: mapping?.resolvedMorphTargetCount ?? mapping?.targets?.length ?? 0,
    missingPresets: (mapping?.missingPresets ?? VRM_EXPRESSION_PRESETS).slice(),
    unresolvedBindingCount: mapping?.unresolvedBindings?.length ?? 0,
    unresolvedBindings: (mapping?.unresolvedBindings ?? []).slice(0, 12).map((entry) => ({
      preset: entry.preset,
      sourceName: entry.sourceName,
      nodeIndex: entry.nodeIndex,
      meshIndex: entry.meshIndex,
      index: entry.index,
      reason: entry.reason,
    })),
  };
}

function parseVrm1Expressions(expressions) {
  const metadata = createExpressionMetadata("vrm1");

  for (const [rawName, expression] of Object.entries(expressions)) {
    const preset = normalizeExpressionPresetName(rawName);

    if (!preset) {
      metadata.ignoredPresets.push(rawName);
      continue;
    }

    const binds = normalizeVrm1Binds(expression?.morphTargetBinds ?? expression?.binds);
    addExpressionPreset(metadata, preset, rawName, binds);
  }

  finalizeMetadata(metadata);
  return metadata;
}

function parseVrm0Expressions(groups, meshNodeIndex) {
  const metadata = createExpressionMetadata("vrm0");

  for (const group of groups) {
    const rawName = group?.presetName ?? group?.name;
    const preset = normalizeExpressionPresetName(rawName) ?? normalizeExpressionPresetName(group?.name);

    if (!preset) {
      if (typeof rawName === "string") {
        metadata.ignoredPresets.push(rawName);
      }
      continue;
    }

    const binds = normalizeVrm0Binds(group?.binds, meshNodeIndex);
    addExpressionPreset(metadata, preset, rawName, binds);
  }

  finalizeMetadata(metadata);
  return metadata;
}

function createExpressionMetadata(version) {
  return {
    version,
    presets: {},
    expressionPresetCount: 0,
    missingPresets: VRM_EXPRESSION_PRESETS.slice(),
    ignoredPresets: [],
  };
}

function addExpressionPreset(metadata, preset, sourceName, binds) {
  if (!VRM_EXPRESSION_PRESET_SET.has(preset) || binds.length === 0) {
    return;
  }

  const current = metadata.presets[preset] ?? { sourceName, binds: [] };
  current.binds.push(...binds);
  metadata.presets[preset] = current;
}

function finalizeMetadata(metadata) {
  metadata.expressionPresetCount = Object.keys(metadata.presets).length;
  metadata.missingPresets = VRM_EXPRESSION_PRESETS.filter((preset) => !metadata.presets[preset]);
}

function normalizeVrm1Binds(binds) {
  if (!Array.isArray(binds)) {
    return [];
  }

  return binds
    .map((bind) => ({
      nodeIndex: normalizeIndex(bind?.node),
      meshIndex: null,
      index: normalizeIndex(bind?.index),
      weight: normalizeBindWeight(bind?.weight),
    }))
    .filter((bind) => Number.isInteger(bind.nodeIndex) && Number.isInteger(bind.index));
}

function normalizeVrm0Binds(binds, meshNodeIndex) {
  if (!Array.isArray(binds)) {
    return [];
  }

  return binds.flatMap((bind) => {
    const meshIndex = normalizeIndex(bind?.mesh);
    const morphIndex = normalizeIndex(bind?.index);
    const weight = normalizeBindWeight(bind?.weight);

    if (!Number.isInteger(morphIndex)) {
      return [];
    }

    const nodeIndices = Number.isInteger(meshIndex)
      ? meshNodeIndex.get(meshIndex) ?? []
      : [];

    if (nodeIndices.length === 0) {
      return [{ nodeIndex: null, meshIndex, index: morphIndex, weight }];
    }

    return nodeIndices.map((nodeIndex) => ({ nodeIndex, meshIndex, index: morphIndex, weight }));
  });
}

function buildMeshNodeIndex(nodes = []) {
  const index = new Map();

  nodes.forEach((node, nodeIndex) => {
    const meshIndex = normalizeIndex(node?.mesh);

    if (!Number.isInteger(meshIndex)) {
      return;
    }

    const nodeIndices = index.get(meshIndex) ?? [];
    nodeIndices.push(nodeIndex);
    index.set(meshIndex, nodeIndices);
  });

  return index;
}

function normalizeExpressionPresetName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const compact = value.trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return PRESET_ALIASES[compact] ?? null;
}

function findMorphTargetObject(object, index) {
  if (!object || !Number.isInteger(index)) {
    return null;
  }

  if (Array.isArray(object.morphTargetInfluences) && index >= 0 && index < object.morphTargetInfluences.length) {
    return object;
  }

  let found = null;

  if (typeof object.traverse === "function") {
    object.traverse((child) => {
      if (!found && Array.isArray(child?.morphTargetInfluences) && index >= 0 && index < child.morphTargetInfluences.length) {
        found = child;
      }
    });
  }

  if (found) {
    return found;
  }

  for (const child of object.children ?? []) {
    found = findMorphTargetObject(child, index);

    if (found) {
      return found;
    }
  }

  return null;
}

function getOrCreateTargetRecord(targetByKey, targets, mesh, index, key) {
  if (targetByKey.has(key)) {
    return targetByKey.get(key);
  }

  const record = {
    mesh,
    index,
    key,
    restInfluence: clamp01(Number(mesh.morphTargetInfluences[index] ?? 0)),
  };
  targetByKey.set(key, record);
  targets.push(record);
  return record;
}

function targetKey(target, index) {
  return `${target.uuid ?? target.name ?? "morph-target"}:${index}`;
}

function createBlendShapeScoreMap(blendShapes) {
  const scores = new Map();

  for (const blendShape of blendShapes ?? []) {
    const rawName = blendShape?.name ?? blendShape?.categoryName ?? blendShape?.displayName ?? blendShape?.label;
    const score = Number(blendShape?.score);

    if (typeof rawName !== "string" || rawName.trim() === "" || !Number.isFinite(score)) {
      continue;
    }

    const key = normalizeBlendShapeName(rawName);
    scores.set(key, Math.max(scores.get(key) ?? 0, clamp01(score)));
  }

  return scores;
}

function aliasEntries(preset) {
  return (BLEND_SHAPE_ALIASES[preset] ?? []).map((name) => ({ name }));
}

function weightedMax(source, entries) {
  return entries.reduce((maxScore, entry) => {
    const score = source.get(normalizeBlendShapeName(entry.name)) ?? 0;
    return Math.max(maxScore, score * (entry.weight ?? 1));
  }, 0);
}

function normalizeBlendShapeName(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function normalizeBindWeight(value) {
  const weight = Number(value ?? 1);

  if (!Number.isFinite(weight)) {
    return 1;
  }

  return clamp01(weight > 1 ? weight / 100 : weight);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
