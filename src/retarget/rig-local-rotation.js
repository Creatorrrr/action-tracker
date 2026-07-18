const MIN_VECTOR_LENGTH = 1e-6;
const MIN_QUATERNION_LENGTH = 1e-8;
const UNIT_VECTOR_ANTIPODAL_EPSILON = 1e-6;
const DEFAULT_HINGE_FULL_WEIGHT_ERROR_DEG = 5;
const DEFAULT_HINGE_ZERO_WEIGHT_ERROR_DEG = 30;
const DEFAULT_ENDPOINT_HINGE_FULL_WEIGHT_CORRECTION_DEG = 60;
const DEFAULT_ENDPOINT_HINGE_ZERO_WEIGHT_CORRECTION_DEG = 120;
const DEFAULT_ENDPOINT_HINGE_RELIABLE_FLEX_START_DEG = 60;
const DEFAULT_ENDPOINT_HINGE_RELIABLE_FLEX_FULL_DEG = 90;

export {
  deriveRigSecondaryAxisLocal,
  limitCausalRigLocalRotation,
  resolveBasisTransportRotation,
  solveRigAdaptiveHingeLocalRotation,
  solveRigEndpointPreservingHingeLocalRotation,
  solveRigHingeLocalRotation,
  solveRigLocalRotation,
};

/**
 * Bounds one solved rig-local target against the quaternion that was actually
 * applied on the preceding frame. The caller owns the angular-velocity
 * contract and frame delta; this helper owns only shortest-path quaternion
 * normalization and interpolation.
 */
function limitCausalRigLocalRotation({
  previousLocalRotation,
  currentLocalRotation,
  deltaMs,
  maxAngularVelocityDegPerSec,
} = {}) {
  const current = normalizeQuaternion(currentLocalRotation);

  if (!current) {
    return invalidCausalRotationResult("invalid-current-local-rotation");
  }

  const frameDeltaMs = Number(deltaMs);

  if (!Number.isFinite(frameDeltaMs) || frameDeltaMs <= 0) {
    return invalidCausalRotationResult("invalid-delta-ms");
  }

  const maximumVelocity = Number(maxAngularVelocityDegPerSec);

  if (!Number.isFinite(maximumVelocity) || maximumVelocity <= 0) {
    return invalidCausalRotationResult("invalid-max-angular-velocity");
  }

  const maximumStepDeg = maximumVelocity * frameDeltaMs / 1000;
  const previous = normalizeQuaternion(previousLocalRotation);

  if (!previous) {
    return {
      valid: true,
      mode: "initialized",
      reason: null,
      localRotation: canonicalizeQuaternionHemisphere(current, null),
      rawDeltaDeg: 0,
      maximumStepDeg,
      appliedDeltaDeg: 0,
      rateLimited: false,
    };
  }

  const target = canonicalizeQuaternionHemisphere(current, previous);
  const rawDeltaDeg = quaternionAngleDeg(previous, target);
  const rateLimited = rawDeltaDeg > maximumStepDeg;
  const localRotation = rateLimited
    ? canonicalizeQuaternionHemisphere(
        slerpQuaternions(previous, target, maximumStepDeg / rawDeltaDeg),
        previous,
      )
    : target;

  if (!localRotation) {
    return invalidCausalRotationResult("unresolvable-causal-local-rotation");
  }

  return {
    valid: true,
    mode: rateLimited ? "rate-limited" : "tracked",
    reason: null,
    localRotation,
    rawDeltaDeg,
    maximumStepDeg,
    appliedDeltaDeg: quaternionAngleDeg(previous, localRotation),
    rateLimited,
  };
}

/**
 * Builds the rigid rotation that carries vectors expressed in one oriented
 * basis into another. Both bases are orthonormalized from their primary and
 * secondary axes, so translation and scale never leak into the result.
 */
function resolveBasisTransportRotation({
  sourcePrimary,
  sourceSecondary,
  targetPrimary,
  targetSecondary,
} = {}) {
  const sourceBasis = quaternionFromBasis(sourcePrimary, sourceSecondary);

  if (!sourceBasis) {
    return invalidBasisTransportResult("invalid-source-basis");
  }

  const targetBasis = quaternionFromBasis(targetPrimary, targetSecondary);

  if (!targetBasis) {
    return invalidBasisTransportResult("invalid-target-basis");
  }

  const rotation = canonicalizeQuaternionHemisphere(
    multiplyQuaternions(targetBasis, invertUnitQuaternion(sourceBasis)),
    null,
  );

  return rotation
    ? { valid: true, reason: null, rotation }
    : invalidBasisTransportResult("unresolvable-basis-transport");
}

/**
 * Converts a semantic avatar-space rest axis into the bone's local rest
 * basis. This keeps the secondary meaning stable across rigs whose shoulder
 * pre-rotations make the same local fallback axis point in different world
 * directions.
 */
function deriveRigSecondaryAxisLocal({
  primaryAxisLocal,
  boneRestWorldRotation,
  semanticSecondaryWorld,
} = {}) {
  const primary = normalizeVector(primaryAxisLocal);
  const boneWorld = normalizeQuaternion(boneRestWorldRotation);
  const semanticWorld = normalizeVector(semanticSecondaryWorld);

  if (!primary) {
    return invalidRigAxisResult("invalid-primary-axis");
  }
  if (!boneWorld) {
    return invalidRigAxisResult("invalid-bone-rest-world-rotation");
  }
  if (!semanticWorld) {
    return invalidRigAxisResult("invalid-semantic-secondary-world");
  }

  const secondaryAxisLocal = projectOntoNormalPlane(
    rotateVectorByQuaternion(semanticWorld, invertUnitQuaternion(boneWorld)),
    primary,
  );

  if (!secondaryAxisLocal) {
    return invalidRigAxisResult("degenerate-semantic-secondary");
  }

  const hingeAxisLocal = normalizeVector(crossVectors(primary, secondaryAxisLocal));

  if (!hingeAxisLocal) {
    return invalidRigAxisResult("degenerate-hinge-axis");
  }

  return {
    valid: true,
    reason: null,
    secondaryAxisLocal,
    hingeAxisLocal,
  };
}

/**
 * Uses absolute rig-local hinge flex only while it agrees with the observed
 * distal segment direction. As disagreement grows, the result continuously
 * returns to the endpoint-preserving primary solve. This prevents an unsigned
 * hinge angle from choosing a wrong bend plane and moving the wrist/ankle far
 * from the tracked endpoint.
 */
function solveRigAdaptiveHingeLocalRotation({
  parentWorldRotation,
  restLocalRotation,
  restPrimaryAxisLocal,
  restSecondaryAxisLocal,
  targetPrimaryWorld,
  flexDeg,
  hingeConfidence = 1,
  hingeFullWeightErrorDeg = DEFAULT_HINGE_FULL_WEIGHT_ERROR_DEG,
  hingeZeroWeightErrorDeg = DEFAULT_HINGE_ZERO_WEIGHT_ERROR_DEG,
  previousLocalRotation = null,
} = {}) {
  const primarySolve = solveRigLocalRotation({
    parentWorldRotation,
    restLocalRotation,
    restPrimaryAxisLocal,
    targetPrimaryWorld,
    previousLocalRotation,
  });

  if (!primarySolve.valid) {
    return {
      ...primarySolve,
      hingeWeight: 0,
      hingeDirectionErrorDeg: null,
      appliedPrimaryErrorDeg: null,
      hingeReason: "primary-solve-failed",
    };
  }

  const parentWorld = normalizeQuaternion(parentWorldRotation);
  const restPrimary = normalizeVector(restPrimaryAxisLocal);
  const targetPrimary = normalizeVector(targetPrimaryWorld);
  const hingeSolve = solveRigHingeLocalRotation({
    restLocalRotation,
    restPrimaryAxisLocal,
    restSecondaryAxisLocal,
    flexDeg,
    previousLocalRotation,
  });

  if (!parentWorld || !restPrimary || !targetPrimary || !hingeSolve.valid) {
    return {
      ...primarySolve,
      mode: "primary-swing",
      hingeWeight: 0,
      hingeDirectionErrorDeg: null,
      appliedPrimaryErrorDeg: 0,
      hingeReason: hingeSolve.reason ?? "invalid-hinge-basis",
    };
  }

  const hingeWorldRotation = multiplyQuaternions(parentWorld, hingeSolve.localRotation);
  const hingePrimaryWorld = normalizeVector(
    rotateVectorByQuaternion(restPrimary, hingeWorldRotation),
  );
  const hingeDirectionErrorDeg = vectorAngleDeg(hingePrimaryWorld, targetPrimary);
  const fullWeightErrorDeg = finiteNonnegative(
    hingeFullWeightErrorDeg,
    DEFAULT_HINGE_FULL_WEIGHT_ERROR_DEG,
  );
  const zeroWeightErrorDeg = Math.max(
    fullWeightErrorDeg + MIN_VECTOR_LENGTH,
    finiteNonnegative(
      hingeZeroWeightErrorDeg,
      DEFAULT_HINGE_ZERO_WEIGHT_ERROR_DEG,
    ),
  );
  const confidence = clamp(Number(hingeConfidence), 0, 1);
  const residualWeight = Number.isFinite(hingeDirectionErrorDeg)
    ? 1 - smoothstep(
        fullWeightErrorDeg,
        zeroWeightErrorDeg,
        hingeDirectionErrorDeg,
      )
    : 0;
  const hingeWeight = Number.isFinite(confidence) ? confidence * residualWeight : 0;
  const blendedLocalRotation = slerpQuaternions(
    primarySolve.localRotation,
    hingeSolve.localRotation,
    hingeWeight,
  );
  const localRotation = canonicalizeQuaternionHemisphere(
    blendedLocalRotation,
    previousLocalRotation,
  );

  if (!localRotation) {
    return {
      ...primarySolve,
      hingeWeight: 0,
      hingeDirectionErrorDeg,
      appliedPrimaryErrorDeg: 0,
      hingeReason: "unresolvable-adaptive-hinge",
    };
  }

  const appliedWorldRotation = multiplyQuaternions(parentWorld, localRotation);
  const appliedPrimaryWorld = normalizeVector(
    rotateVectorByQuaternion(restPrimary, appliedWorldRotation),
  );

  return {
    ...primarySolve,
    mode: hingeWeight > MIN_VECTOR_LENGTH ? "adaptive-hinge" : "primary-swing",
    localRotation,
    hingeAxisLocal: hingeSolve.hingeAxisLocal,
    flexDeg: hingeSolve.flexDeg,
    hingeWeight,
    hingeDirectionErrorDeg,
    appliedPrimaryErrorDeg: vectorAngleDeg(appliedPrimaryWorld, targetPrimary),
    hingeReason: null,
  };
}

/**
 * Retains the rig-defined hinge twist while enforcing the observed endpoint.
 *
 * The absolute hinge solve often has a useful local twist but its primary axis
 * can disagree with a monocularly observed wrist direction. Applying the
 * shortest world-space correction from that hinge primary to the observed
 * primary produces the closest hinge-derived orientation whose bone axis
 * reaches the tracked endpoint exactly.
 */
function solveRigEndpointPreservingHingeLocalRotation({
  parentWorldRotation,
  restLocalRotation,
  restPrimaryAxisLocal,
  restSecondaryAxisLocal,
  targetPrimaryWorld,
  flexDeg,
  hingeConfidence = 1,
  hingeFullWeightCorrectionDeg = DEFAULT_ENDPOINT_HINGE_FULL_WEIGHT_CORRECTION_DEG,
  hingeZeroWeightCorrectionDeg = DEFAULT_ENDPOINT_HINGE_ZERO_WEIGHT_CORRECTION_DEG,
  hingeReliableFlexStartDeg = DEFAULT_ENDPOINT_HINGE_RELIABLE_FLEX_START_DEG,
  hingeReliableFlexFullDeg = DEFAULT_ENDPOINT_HINGE_RELIABLE_FLEX_FULL_DEG,
  previousLocalRotation = null,
} = {}) {
  const primarySolve = solveRigLocalRotation({
    parentWorldRotation,
    restLocalRotation,
    restPrimaryAxisLocal,
    targetPrimaryWorld,
    previousLocalRotation,
  });

  if (!primarySolve.valid) {
    return {
      ...primarySolve,
      hingeWeight: 0,
      hingeFlexReliability: 0,
      hingeCorrectionDeg: null,
      appliedPrimaryErrorDeg: null,
      hingeReason: "primary-solve-failed",
    };
  }

  const parentWorld = normalizeQuaternion(parentWorldRotation);
  const restPrimary = normalizeVector(restPrimaryAxisLocal);
  const targetPrimary = normalizeVector(targetPrimaryWorld);
  const hingeSolve = solveRigHingeLocalRotation({
    restLocalRotation,
    restPrimaryAxisLocal,
    restSecondaryAxisLocal,
    flexDeg,
    previousLocalRotation,
  });

  if (!parentWorld || !restPrimary || !targetPrimary || !hingeSolve.valid) {
    return {
      ...primarySolve,
      mode: "primary-swing",
      hingeWeight: 0,
      hingeFlexReliability: 0,
      hingeCorrectionDeg: null,
      appliedPrimaryErrorDeg: 0,
      hingeReason: hingeSolve.reason ?? "invalid-hinge-basis",
    };
  }

  const hingeWorldRotation = multiplyQuaternions(parentWorld, hingeSolve.localRotation);
  const hingePrimaryWorld = normalizeVector(
    rotateVectorByQuaternion(restPrimary, hingeWorldRotation),
  );
  const hingeCorrectionDeg = vectorAngleDeg(hingePrimaryWorld, targetPrimary);
  const fullWeightCorrectionDeg = finiteNonnegative(
    hingeFullWeightCorrectionDeg,
    DEFAULT_ENDPOINT_HINGE_FULL_WEIGHT_CORRECTION_DEG,
  );
  const zeroWeightCorrectionDeg = Math.max(
    fullWeightCorrectionDeg + MIN_VECTOR_LENGTH,
    finiteNonnegative(
      hingeZeroWeightCorrectionDeg,
      DEFAULT_ENDPOINT_HINGE_ZERO_WEIGHT_CORRECTION_DEG,
    ),
  );
  const confidence = clamp(Number(hingeConfidence), 0, 1);
  const reliableFlexStartDeg = finiteNonnegative(
    hingeReliableFlexStartDeg,
    DEFAULT_ENDPOINT_HINGE_RELIABLE_FLEX_START_DEG,
  );
  const reliableFlexFullDeg = Math.max(
    reliableFlexStartDeg + MIN_VECTOR_LENGTH,
    finiteNonnegative(
      hingeReliableFlexFullDeg,
      DEFAULT_ENDPOINT_HINGE_RELIABLE_FLEX_FULL_DEG,
    ),
  );
  // A nearly straight three-point chain has an ill-conditioned bend plane:
  // tiny monocular depth noise can flip the inferred hinge roll while the
  // tracked endpoint remains plausible. Fade hinge-derived roll in only once
  // the bend itself is observable; the primary solve still reaches the wrist.
  const hingeFlexReliability = smoothstep(
    reliableFlexStartDeg,
    reliableFlexFullDeg,
    hingeSolve.flexDeg,
  );

  if (
    !hingePrimaryWorld ||
    !Number.isFinite(hingeCorrectionDeg) ||
    !Number.isFinite(confidence) ||
    confidence <= MIN_VECTOR_LENGTH ||
    hingeFlexReliability <= MIN_VECTOR_LENGTH ||
    hingeCorrectionDeg >= zeroWeightCorrectionDeg
  ) {
    return {
      ...primarySolve,
      mode: "primary-swing",
      hingeAxisLocal: hingeSolve.hingeAxisLocal,
      flexDeg: hingeSolve.flexDeg,
      hingeWeight: 0,
      hingeFlexReliability,
      hingeCorrectionDeg: Number.isFinite(hingeCorrectionDeg) ? hingeCorrectionDeg : null,
      appliedPrimaryErrorDeg: 0,
      hingeReason: confidence <= MIN_VECTOR_LENGTH
        ? "low-hinge-confidence"
        : hingeFlexReliability <= MIN_VECTOR_LENGTH
          ? "unobservable-hinge-flex"
        : "hinge-correction-opposed",
    };
  }

  const correctionWorld = hingePrimaryWorld
    ? quaternionFromUnitVectors(hingePrimaryWorld, targetPrimary)
    : null;
  const correctedWorldRotation = correctionWorld
    ? multiplyQuaternions(correctionWorld, hingeWorldRotation)
    : null;
  const correctedLocalRotation = correctedWorldRotation
    ? multiplyQuaternions(invertUnitQuaternion(parentWorld), correctedWorldRotation)
    : null;
  const transportedLocalRotation = canonicalizeQuaternionHemisphere(
    correctedLocalRotation,
    previousLocalRotation,
  );

  if (!transportedLocalRotation) {
    return {
      ...primarySolve,
      mode: "primary-swing",
      hingeWeight: 0,
      hingeFlexReliability,
      hingeCorrectionDeg: null,
      appliedPrimaryErrorDeg: 0,
      hingeReason: "unresolvable-endpoint-correction",
    };
  }

  const hingeWeight = confidence * hingeFlexReliability * (
    1 - smoothstep(
      fullWeightCorrectionDeg,
      zeroWeightCorrectionDeg,
      hingeCorrectionDeg,
    )
  );
  const localRotation = canonicalizeQuaternionHemisphere(
    slerpQuaternions(
      primarySolve.localRotation,
      transportedLocalRotation,
      hingeWeight,
    ),
    previousLocalRotation,
  );

  if (!localRotation) {
    return {
      ...primarySolve,
      mode: "primary-swing",
      hingeWeight: 0,
      hingeFlexReliability,
      hingeCorrectionDeg,
      appliedPrimaryErrorDeg: 0,
      hingeReason: "unresolvable-endpoint-blend",
    };
  }

  const appliedWorldRotation = multiplyQuaternions(parentWorld, localRotation);
  const appliedPrimaryWorld = normalizeVector(
    rotateVectorByQuaternion(restPrimary, appliedWorldRotation),
  );

  return {
    ...primarySolve,
    mode: hingeWeight > MIN_VECTOR_LENGTH
      ? "endpoint-preserving-hinge"
      : "primary-swing",
    localRotation,
    hingeAxisLocal: hingeSolve.hingeAxisLocal,
    flexDeg: hingeSolve.flexDeg,
    hingeWeight,
    hingeFlexReliability,
    hingeCorrectionDeg,
    appliedPrimaryErrorDeg: vectorAngleDeg(appliedPrimaryWorld, targetPrimary),
    hingeReason: null,
  };
}

/**
 * Solves an absolute distal-bone rotation from a rig-defined hinge and a
 * positive anatomical flexion angle. Both rest axes are bone-local, so their
 * cross product gives a mirrored, rig-specific hinge without world-axis
 * assumptions. Flexion is deliberately bounded to the unambiguous anatomical
 * interval [0, 180] degrees.
 */
function solveRigHingeLocalRotation({
  restLocalRotation,
  restPrimaryAxisLocal,
  restSecondaryAxisLocal,
  flexDeg,
  previousLocalRotation = null,
} = {}) {
  const restLocal = normalizeQuaternion(restLocalRotation);
  const restPrimary = normalizeVector(restPrimaryAxisLocal);
  const restSecondary = normalizeVector(restSecondaryAxisLocal);
  const resolvedFlexDeg = flexDeg === null || flexDeg === undefined || flexDeg === ""
    ? Number.NaN
    : Number(flexDeg);

  if (!restLocal) {
    return invalidHingeResult("invalid-rest-local-rotation");
  }
  if (!restPrimary) {
    return invalidHingeResult("invalid-rest-primary-axis");
  }
  if (!restSecondary) {
    return invalidHingeResult("invalid-rest-secondary-axis");
  }
  if (!Number.isFinite(resolvedFlexDeg)) {
    return invalidHingeResult("invalid-flex-deg");
  }
  if (resolvedFlexDeg < 0 || resolvedFlexDeg > 180) {
    return invalidHingeResult("flex-deg-out-of-range");
  }

  const hingeAxisLocal = normalizeVector(crossVectors(restPrimary, restSecondary));

  if (!hingeAxisLocal) {
    return invalidHingeResult("degenerate-rest-hinge-basis");
  }

  const hingeRotation = quaternionFromAxisAngle(
    hingeAxisLocal,
    resolvedFlexDeg * Math.PI / 180,
  );
  const localRotation = canonicalizeQuaternionHemisphere(
    // The hinge is expressed in the bone's own coordinates, so it must be
    // applied before the rest-local transform (post-multiplied in qLocal).
    multiplyQuaternions(restLocal, hingeRotation),
    previousLocalRotation,
  );

  if (!localRotation) {
    return invalidHingeResult("unresolvable-local-rotation");
  }

  return {
    valid: true,
    mode: "hinge-flexion",
    reason: null,
    localRotation,
    hingeAxisLocal,
    flexDeg: resolvedFlexDeg,
  };
}

/**
 * Solves an absolute bone-local quaternion from world-space aim targets.
 *
 * `restPrimaryAxisLocal` and `restSecondaryAxisLocal` are expressed in the
 * bone's own coordinate system. `restLocalRotation` is the bone's absolute
 * local quaternion in the rig rest pose, and `parentWorldRotation` must be the
 * current (not rest-pose) parent world quaternion.
 *
 * Without a usable secondary target this intentionally matches the existing
 * shortest-arc swing semantics: swing(rest direction -> target direction) *
 * restLocalRotation. When both secondary axes are usable, the complete target
 * basis also resolves twist. The returned representation is placed in the
 * same quaternion hemisphere as `previousLocalRotation` when supplied.
 */
function solveRigLocalRotation({
  parentWorldRotation,
  restLocalRotation,
  restPrimaryAxisLocal,
  restSecondaryAxisLocal = null,
  targetPrimaryWorld,
  targetSecondaryWorld = null,
  previousLocalRotation = null,
} = {}) {
  const parentWorld = normalizeQuaternion(parentWorldRotation);
  const restLocal = normalizeQuaternion(restLocalRotation);
  const restPrimaryAxis = normalizeVector(restPrimaryAxisLocal);
  const targetPrimary = normalizeVector(targetPrimaryWorld);

  if (!parentWorld) {
    return invalidResult("invalid-parent-world-rotation");
  }
  if (!restLocal) {
    return invalidResult("invalid-rest-local-rotation");
  }
  if (!restPrimaryAxis) {
    return invalidResult("invalid-rest-primary-axis");
  }
  if (!targetPrimary) {
    return invalidResult("invalid-target-primary");
  }

  const inverseParentWorld = invertUnitQuaternion(parentWorld);
  const targetPrimaryParent = normalizeVector(
    rotateVectorByQuaternion(targetPrimary, inverseParentWorld),
  );
  const restPrimaryParent = normalizeVector(
    rotateVectorByQuaternion(restPrimaryAxis, restLocal),
  );

  if (!targetPrimaryParent || !restPrimaryParent) {
    return invalidResult("unresolvable-primary-basis");
  }

  const restSecondaryAxis = normalizeVector(restSecondaryAxisLocal);
  const targetSecondary = normalizeVector(targetSecondaryWorld);
  const restSecondaryParent = restSecondaryAxis
    ? normalizeVector(rotateVectorByQuaternion(restSecondaryAxis, restLocal))
    : null;
  const targetSecondaryParent = targetSecondary
    ? normalizeVector(rotateVectorByQuaternion(targetSecondary, inverseParentWorld))
    : null;
  const restBasis = restSecondaryParent
    ? quaternionFromBasis(restPrimaryParent, restSecondaryParent)
    : null;
  const targetBasis = targetSecondaryParent
    ? quaternionFromBasis(targetPrimaryParent, targetSecondaryParent)
    : null;
  const useFullBasis = Boolean(restBasis && targetBasis);
  const rawLocalRotation = useFullBasis
    ? multiplyQuaternions(
      multiplyQuaternions(targetBasis, invertUnitQuaternion(restBasis)),
      restLocal,
    )
    : multiplyQuaternions(
      quaternionFromUnitVectors(restPrimaryParent, targetPrimaryParent),
      restLocal,
    );
  const localRotation = canonicalizeQuaternionHemisphere(
    rawLocalRotation,
    previousLocalRotation,
  );

  if (!localRotation) {
    return invalidResult("unresolvable-local-rotation");
  }

  return {
    valid: true,
    mode: useFullBasis ? "full-basis" : "primary-swing",
    reason: null,
    localRotation,
    targetPrimaryParent,
    targetSecondaryParent: useFullBasis ? targetSecondaryParent : null,
  };
}


function quaternionFromUnitVectors(from, to) {
  const dot = clamp(dotVectors(from, to), -1, 1);
  let quaternion;

  // Match THREE.Quaternion.setFromUnitVectors so ordinary aim behavior does
  // not change when this pure solver replaces the renderer-local calculation.
  if (dot + 1 < UNIT_VECTOR_ANTIPODAL_EPSILON) {
    quaternion = Math.abs(from.x) > Math.abs(from.z)
      ? { x: -from.y, y: from.x, z: 0, w: 0 }
      : { x: 0, y: -from.z, z: from.y, w: 0 };
  } else {
    const cross = crossVectors(from, to);
    quaternion = {
      x: cross.x,
      y: cross.y,
      z: cross.z,
      w: dot + 1,
    };
  }

  return normalizeQuaternion(quaternion);
}

function quaternionFromAxisAngle(axis, angle) {
  const normalizedAxis = normalizeVector(axis);

  if (!normalizedAxis || !Number.isFinite(angle)) {
    return null;
  }

  const half = angle / 2;
  const scale = Math.sin(half);

  return normalizeQuaternion({
    x: normalizedAxis.x * scale,
    y: normalizedAxis.y * scale,
    z: normalizedAxis.z * scale,
    w: Math.cos(half),
  });
}

function slerpQuaternions(from, to, weight) {
  const left = normalizeQuaternion(from);
  let right = normalizeQuaternion(to);

  if (!left || !right) {
    return left ?? right;
  }

  let cosine = clamp(dotQuaternions(left, right), -1, 1);

  if (cosine < 0) {
    right = negateQuaternion(right);
    cosine = -cosine;
  }

  const amount = clamp(Number(weight), 0, 1);

  if (cosine > 1 - MIN_QUATERNION_LENGTH) {
    return normalizeQuaternion({
      x: left.x + (right.x - left.x) * amount,
      y: left.y + (right.y - left.y) * amount,
      z: left.z + (right.z - left.z) * amount,
      w: left.w + (right.w - left.w) * amount,
    });
  }

  const angle = Math.acos(cosine);
  const sine = Math.sin(angle);
  const leftScale = Math.sin((1 - amount) * angle) / sine;
  const rightScale = Math.sin(amount * angle) / sine;

  return normalizeQuaternion({
    x: left.x * leftScale + right.x * rightScale,
    y: left.y * leftScale + right.y * rightScale,
    z: left.z * leftScale + right.z * rightScale,
    w: left.w * leftScale + right.w * rightScale,
  });
}

function quaternionFromBasis(primary, secondary) {
  const xAxis = normalizeVector(primary);
  const yAxis = projectOntoNormalPlane(secondary, xAxis);

  if (!xAxis || !yAxis) {
    return null;
  }

  const zAxis = normalizeVector(crossVectors(xAxis, yAxis));

  if (!zAxis) {
    return null;
  }

  // Matrix columns are the orthonormal basis axes, matching
  // THREE.Matrix4.makeBasis followed by Quaternion.setFromRotationMatrix.
  const m11 = xAxis.x;
  const m12 = yAxis.x;
  const m13 = zAxis.x;
  const m21 = xAxis.y;
  const m22 = yAxis.y;
  const m23 = zAxis.y;
  const m31 = xAxis.z;
  const m32 = yAxis.z;
  const m33 = zAxis.z;
  const trace = m11 + m22 + m33;
  let quaternion;

  if (trace > 0) {
    const scale = 2 * Math.sqrt(trace + 1);
    quaternion = {
      x: (m32 - m23) / scale,
      y: (m13 - m31) / scale,
      z: (m21 - m12) / scale,
      w: scale / 4,
    };
  } else if (m11 > m22 && m11 > m33) {
    const scale = 2 * Math.sqrt(1 + m11 - m22 - m33);
    quaternion = {
      x: scale / 4,
      y: (m12 + m21) / scale,
      z: (m13 + m31) / scale,
      w: (m32 - m23) / scale,
    };
  } else if (m22 > m33) {
    const scale = 2 * Math.sqrt(1 + m22 - m11 - m33);
    quaternion = {
      x: (m12 + m21) / scale,
      y: scale / 4,
      z: (m23 + m32) / scale,
      w: (m13 - m31) / scale,
    };
  } else {
    const scale = 2 * Math.sqrt(1 + m33 - m11 - m22);
    quaternion = {
      x: (m13 + m31) / scale,
      y: (m23 + m32) / scale,
      z: scale / 4,
      w: (m21 - m12) / scale,
    };
  }

  return normalizeQuaternion(quaternion);
}

function canonicalizeQuaternionHemisphere(value, reference) {
  const quaternion = normalizeQuaternion(value);

  if (!quaternion) {
    return null;
  }

  const previous = normalizeQuaternion(reference);

  if (previous) {
    return dotQuaternions(quaternion, previous) < 0
      ? negateQuaternion(quaternion)
      : quaternion;
  }

  // A deterministic representation prevents q/-q churn before the first
  // temporal reference is available.
  const signComponent = Math.abs(quaternion.w) > MIN_QUATERNION_LENGTH
    ? quaternion.w
    : Math.abs(quaternion.x) > MIN_QUATERNION_LENGTH
      ? quaternion.x
      : Math.abs(quaternion.y) > MIN_QUATERNION_LENGTH
        ? quaternion.y
        : quaternion.z;

  return signComponent < 0 ? negateQuaternion(quaternion) : quaternion;
}

function projectOntoNormalPlane(value, normal) {
  const vector = normalizeVector(value);
  const normalizedNormal = normalizeVector(normal);

  if (!vector || !normalizedNormal) {
    return null;
  }

  return normalizeVector(subtractVectors(
    vector,
    multiplyVector(normalizedNormal, dotVectors(vector, normalizedNormal)),
  ));
}

function rotateVectorByQuaternion(vector, quaternion) {
  const qVector = { x: quaternion.x, y: quaternion.y, z: quaternion.z };
  const uv = crossVectors(qVector, vector);
  const uuv = crossVectors(qVector, uv);

  return addVectors(
    vector,
    addVectors(
      multiplyVector(uv, 2 * quaternion.w),
      multiplyVector(uuv, 2),
    ),
  );
}

function multiplyQuaternions(left, right) {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function invertUnitQuaternion(value) {
  return {
    x: -value.x,
    y: -value.y,
    z: -value.z,
    w: value.w,
  };
}

function normalizeQuaternion(value) {
  const quaternion = quaternionFrom(value);

  if (!quaternion) {
    return null;
  }

  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(length) || length < MIN_QUATERNION_LENGTH) {
    return null;
  }

  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
}

function normalizeVector(value) {
  const vector = vectorFrom(value);

  if (!vector) {
    return null;
  }

  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (!Number.isFinite(length) || length < MIN_VECTOR_LENGTH) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function vectorFrom(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const vector = { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) };
    return finiteVector(vector) ? vector : null;
  }

  if (value && typeof value === "object") {
    const vector = { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
    return finiteVector(vector) ? vector : null;
  }

  return null;
}

function quaternionFrom(value) {
  if (Array.isArray(value) && value.length >= 4) {
    const quaternion = {
      x: Number(value[0]),
      y: Number(value[1]),
      z: Number(value[2]),
      w: Number(value[3]),
    };
    return finiteQuaternion(quaternion) ? quaternion : null;
  }

  if (value && typeof value === "object") {
    const quaternion = {
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
      w: Number(value.w),
    };
    return finiteQuaternion(quaternion) ? quaternion : null;
  }

  return null;
}

function invalidResult(reason) {
  return {
    valid: false,
    mode: "unavailable",
    reason,
    localRotation: null,
    targetPrimaryParent: null,
    targetSecondaryParent: null,
  };
}

function invalidHingeResult(reason) {
  return {
    valid: false,
    mode: "unavailable",
    reason,
    localRotation: null,
    hingeAxisLocal: null,
    flexDeg: null,
  };
}

function invalidRigAxisResult(reason) {
  return {
    valid: false,
    reason,
    secondaryAxisLocal: null,
    hingeAxisLocal: null,
  };
}

function invalidBasisTransportResult(reason) {
  return {
    valid: false,
    reason,
    rotation: null,
  };
}

function invalidCausalRotationResult(reason) {
  return {
    valid: false,
    mode: "unavailable",
    reason,
    localRotation: null,
    rawDeltaDeg: null,
    maximumStepDeg: null,
    appliedDeltaDeg: null,
    rateLimited: false,
  };
}

function finiteVector(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function finiteQuaternion(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Number.isFinite(value.z) && Number.isFinite(value.w);
}

function dotVectors(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function dotQuaternions(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

function quaternionAngleDeg(a, b) {
  const left = normalizeQuaternion(a);
  const right = normalizeQuaternion(b);

  if (!left || !right) {
    return null;
  }

  return 2 * Math.acos(clamp(Math.abs(dotQuaternions(left, right)), -1, 1)) * 180 / Math.PI;
}

function vectorAngleDeg(a, b) {
  const left = normalizeVector(a);
  const right = normalizeVector(b);

  if (!left || !right) {
    return null;
  }

  return Math.acos(clamp(dotVectors(left, right), -1, 1)) * 180 / Math.PI;
}

function crossVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVectors(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function multiplyVector(value, scalar) {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function negateQuaternion(value) {
  return { x: -value.x, y: -value.y, z: -value.z, w: -value.w };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonnegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function smoothstep(edge0, edge1, value) {
  const ratio = clamp((value - edge0) / Math.max(MIN_VECTOR_LENGTH, edge1 - edge0), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}
