export const VRM_REQUIRED_MIXAMO_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

export const VRM_FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
export const VRM_FRONT_AXIS = {
  vrm0: {
    sign: -1,
    recommendedModelYawRad: Math.PI,
  },
  vrm1: {
    sign: 1,
    recommendedModelYawRad: 0,
  },
};

const VRM_BODY_TO_MIXAMO = {
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Spine1',
  upperChest: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  leftEye: 'LeftEye',
  rightEye: 'RightEye',
  leftShoulder: 'LeftShoulder',
  rightShoulder: 'RightShoulder',
  leftUpperArm: 'LeftArm',
  rightUpperArm: 'RightArm',
  leftLowerArm: 'LeftForeArm',
  rightLowerArm: 'RightForeArm',
  leftHand: 'LeftHand',
  rightHand: 'RightHand',
  leftUpperLeg: 'LeftUpLeg',
  rightUpperLeg: 'RightUpLeg',
  leftLowerLeg: 'LeftLeg',
  rightLowerLeg: 'RightLeg',
  leftFoot: 'LeftFoot',
  rightFoot: 'RightFoot',
  leftToes: 'LeftToeBase',
  rightToes: 'RightToeBase',
};

const NON_THUMB_FINGER_SEGMENTS = ['Proximal', 'Intermediate', 'Distal'];
const VRM1_THUMB_SEGMENTS = ['Metacarpal', 'Proximal', 'Distal'];
const VRM0_THUMB_SEGMENTS = ['Proximal', 'Intermediate', 'Distal'];
const SIDE_PREFIXES = [
  { canonical: 'left', mixamo: 'Left' },
  { canonical: 'right', mixamo: 'Right' },
];

const FINGER_CANONICAL_NAMES = {
  Index: 'Index',
  Middle: 'Middle',
  Ring: 'Ring',
  Pinky: 'Little',
};

export function parseVrmHumanoid(json) {
  const vrm1HumanBones = json?.extensions?.VRMC_vrm?.humanoid?.humanBones;

  if (vrm1HumanBones && typeof vrm1HumanBones === 'object' && !Array.isArray(vrm1HumanBones)) {
    return {
      version: 'vrm1',
      frontAxisSign: VRM_FRONT_AXIS.vrm1.sign,
      recommendedModelYawRad: VRM_FRONT_AXIS.vrm1.recommendedModelYawRad,
      canonicalToNode: objectHumanBonesToMap(vrm1HumanBones),
    };
  }

  const vrm0HumanBones = json?.extensions?.VRM?.humanoid?.humanBones;

  if (Array.isArray(vrm0HumanBones)) {
    return {
      version: 'vrm0',
      frontAxisSign: VRM_FRONT_AXIS.vrm0.sign,
      recommendedModelYawRad: VRM_FRONT_AXIS.vrm0.recommendedModelYawRad,
      canonicalToNode: arrayHumanBonesToMap(vrm0HumanBones),
    };
  }

  return null;
}

export function createVrmHumanoidMapping(humanoid) {
  const canonicalToNode = humanoid?.canonicalToNode ?? new Map();
  const mixamoToNode = new Map();
  const canonicalMappings = {};
  const fallbackAliases = [];
  let ignoredCanonicals = [];

  if (!humanoid) {
    return {
      version: null,
      frontAxisSign: 0,
      recommendedModelYawRad: 0,
      canonicalCount: 0,
      mixamoToNode,
      canonicalMappings,
      fallbackAliases,
      ignoredCanonicals,
      missingRequiredBones: VRM_REQUIRED_MIXAMO_BONES.slice(),
      fingerChains: buildFingerChainReport(mixamoToNode),
    };
  }

  for (const [canonical, nodeIndex] of canonicalToNode) {
    const mixamoName = VRM_BODY_TO_MIXAMO[canonical];

    if (!mixamoName) {
      continue;
    }

    setMixamoMapping(mixamoToNode, canonicalMappings, mixamoName, nodeIndex, canonical);
  }

  addSpineFallbacks(canonicalToNode, mixamoToNode, canonicalMappings, fallbackAliases);
  addFingerMappings(humanoid.version, canonicalToNode, mixamoToNode, canonicalMappings);
  ignoredCanonicals = [...canonicalToNode.keys()].filter((canonical) => (
    !Object.values(canonicalMappings).some((entry) => entry.canonical === canonical)
  ));

  return {
    version: humanoid.version,
    frontAxisSign: humanoid.frontAxisSign ?? 0,
    recommendedModelYawRad: humanoid.recommendedModelYawRad ?? 0,
    canonicalCount: canonicalToNode.size,
    mixamoToNode,
    canonicalMappings,
    fallbackAliases,
    ignoredCanonicals,
    missingRequiredBones: VRM_REQUIRED_MIXAMO_BONES.filter((name) => !mixamoToNode.has(name)),
    fingerChains: buildFingerChainReport(mixamoToNode),
  };
}

export function serializeVrmHumanoidMapping(mapping) {
  return {
    version: mapping?.version ?? null,
    frontAxisSign: mapping?.frontAxisSign ?? 0,
    recommendedModelYawRad: mapping?.recommendedModelYawRad ?? 0,
    canonicalCount: mapping?.canonicalCount ?? 0,
    mixamoMappings: Object.fromEntries(mapping?.mixamoToNode ?? []),
    canonicalMappings: mapping?.canonicalMappings ?? {},
    fallbackAliases: mapping?.fallbackAliases ?? [],
    ignoredCanonicals: mapping?.ignoredCanonicals ?? [],
    missingRequiredBones: mapping?.missingRequiredBones ?? VRM_REQUIRED_MIXAMO_BONES.slice(),
    fingerChains: mapping?.fingerChains ?? buildFingerChainReport(new Map()),
  };
}

function objectHumanBonesToMap(humanBones) {
  const result = new Map();

  for (const [canonical, entry] of Object.entries(humanBones)) {
    const nodeIndex = Number(entry?.node);

    if (Number.isInteger(nodeIndex) && nodeIndex >= 0) {
      result.set(canonical, nodeIndex);
    }
  }

  return result;
}

function arrayHumanBonesToMap(humanBones) {
  const result = new Map();

  for (const entry of humanBones) {
    const canonical = entry?.bone;
    const nodeIndex = Number(entry?.node);

    if (typeof canonical === 'string' && Number.isInteger(nodeIndex) && nodeIndex >= 0) {
      result.set(canonical, nodeIndex);
    }
  }

  return result;
}

function addSpineFallbacks(canonicalToNode, mixamoToNode, canonicalMappings, fallbackAliases) {
  if (!mixamoToNode.has('Spine1') && canonicalToNode.has('spine')) {
    setFallbackMapping(mixamoToNode, canonicalMappings, fallbackAliases, 'Spine1', canonicalToNode.get('spine'), 'spine');
  }

  if (mixamoToNode.has('Spine2')) {
    return;
  }

  if (canonicalToNode.has('chest')) {
    setFallbackMapping(mixamoToNode, canonicalMappings, fallbackAliases, 'Spine2', canonicalToNode.get('chest'), 'chest');
    return;
  }

  if (canonicalToNode.has('spine')) {
    setFallbackMapping(mixamoToNode, canonicalMappings, fallbackAliases, 'Spine2', canonicalToNode.get('spine'), 'spine');
  }
}

function addFingerMappings(version, canonicalToNode, mixamoToNode, canonicalMappings) {
  for (const side of SIDE_PREFIXES) {
    addThumbMappings(version, side, canonicalToNode, mixamoToNode, canonicalMappings);

    for (const [mixamoFinger, canonicalFinger] of Object.entries(FINGER_CANONICAL_NAMES)) {
      NON_THUMB_FINGER_SEGMENTS.forEach((segment, index) => {
        const canonical = `${side.canonical}${canonicalFinger}${segment}`;
        const mixamoName = `${side.mixamo}Hand${mixamoFinger}${index + 1}`;

        if (canonicalToNode.has(canonical)) {
          setMixamoMapping(mixamoToNode, canonicalMappings, mixamoName, canonicalToNode.get(canonical), canonical);
        }
      });
    }
  }
}

function addThumbMappings(version, side, canonicalToNode, mixamoToNode, canonicalMappings) {
  const segments = version === 'vrm0' ? VRM0_THUMB_SEGMENTS : VRM1_THUMB_SEGMENTS;

  segments.forEach((segment, index) => {
    const canonical = `${side.canonical}Thumb${segment}`;
    const mixamoName = `${side.mixamo}HandThumb${index + 1}`;

    if (canonicalToNode.has(canonical)) {
      setMixamoMapping(mixamoToNode, canonicalMappings, mixamoName, canonicalToNode.get(canonical), canonical);
    }
  });
}

function setFallbackMapping(mixamoToNode, canonicalMappings, fallbackAliases, mixamoName, nodeIndex, canonical) {
  setMixamoMapping(mixamoToNode, canonicalMappings, mixamoName, nodeIndex, canonical);
  fallbackAliases.push({ mixamoName, canonical, nodeIndex });
}

function setMixamoMapping(mixamoToNode, canonicalMappings, mixamoName, nodeIndex, canonical) {
  mixamoToNode.set(mixamoName, nodeIndex);
  canonicalMappings[mixamoName] = {
    canonical,
    nodeIndex,
  };
}

function buildFingerChainReport(mixamoToNode) {
  const report = {};

  for (const side of ['Left', 'Right']) {
    report[side] = {};

    for (const finger of VRM_FINGER_NAMES) {
      const mappedSegments = [1, 2, 3, 4]
        .filter((segment) => mixamoToNode.has(`${side}Hand${finger}${segment}`));

      report[side][finger] = {
        length: mappedSegments.length,
        segments: mappedSegments,
      };
    }
  }

  return report;
}
