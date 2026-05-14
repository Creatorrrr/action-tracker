import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_MODEL_URL = './assets/models/Xbot.glb';
const BONE_PREFIX = 'mixamorig:';
const MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_LANDMARK_DEPTH_SCALE = 0.45;
const FIRST_UPDATE_DELTA_MS = 16.67;
const DEPTH_REFERENCE_SCALE = 1;
const DEPTH_MATCH_THRESHOLD_DEG = 35;
const DEPTH_SALIENT_Z_RATIO = 0.18;
const PROPORTION_CALIBRATION_FRAMES = 30;
const PROPORTION_CALIBRATION_MIN_SEGMENTS = 6;
const MIN_BONE_LENGTH_SCALE = 0.72;
const MAX_BONE_LENGTH_SCALE = 1.38;
const MAX_HAND_LENGTH_SCALE = 1.65;
const PERFORMANCE_SAMPLE_LIMIT = 240;
const PERFORMANCE_BUDGETS_MS = {
  updateMedian: 1.5,
  updateP95: 3,
  renderMedian: 8,
  renderP95: 14,
  validationMedian: 1,
  validationP95: 2,
};
const RETARGET_SMOOTHING_MS = {
  torso: 72,
  neck: 58,
  head: 58,
  shoulder: 48,
  upperArm: 34,
  foreArm: 30,
  upperLeg: 44,
  lowerLeg: 40,
  foot: 48,
  hand: 36,
  fingerBase: 44,
  finger: 34,
  relax: 76,
};
const ORBIT_ROTATE_SPEED = 0.006;
const ORBIT_ZOOM_SPEED = 0.0012;
const ORBIT_MIN_POLAR = THREE.MathUtils.degToRad(12);
const ORBIT_MAX_POLAR = THREE.MathUtils.degToRad(168);
const ORBIT_MIN_DISTANCE_SCALE = 0.62;
const ORBIT_MAX_DISTANCE_SCALE = 3.25;

const POSE = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftFootIndex: 31,
  rightFootIndex: 32,
};

const HAND_FINGERS = {
  Thumb: [1, 2, 3, 4],
  Index: [5, 6, 7, 8],
  Middle: [9, 10, 11, 12],
  Ring: [13, 14, 15, 16],
  Pinky: [17, 18, 19, 20],
};

const REQUIRED_BONES = [
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
  'LeftHandThumb1',
  'LeftHandIndex1',
  'LeftHandMiddle1',
  'LeftHandRing1',
  'LeftHandPinky1',
  'RightHandThumb1',
  'RightHandIndex1',
  'RightHandMiddle1',
  'RightHandRing1',
  'RightHandPinky1',
];

const BODY_RETARGETS = [
  { bone: 'Hips', from: 'hipMid', to: 'shoulderMid', strength: 0.5, maxAngle: 0.75, maxTwist: 0.3, smoothing: 'torso' },
  { bone: 'Spine', from: 'hipMid', to: 'shoulderMid', strength: 0.75, maxAngle: 0.9, maxTwist: 0.24, smoothing: 'torso' },
  { bone: 'Spine1', from: 'hipMid', to: 'shoulderMid', strength: 0.82, maxAngle: 0.92, maxTwist: 0.24, smoothing: 'torso' },
  { bone: 'Spine2', from: 'hipMid', to: 'shoulderMid', strength: 0.9, maxAngle: 0.95, maxTwist: 0.26, smoothing: 'torso' },
  { bone: 'Neck', from: 'shoulderMid', to: 'nose', strength: 0.9, maxAngle: 1.05, maxTwist: 0.35, smoothing: 'neck' },
  { bone: 'Head', from: 'eyeMid', to: 'nose', strength: 0.75, maxAngle: 0.95, maxTwist: 0.38, smoothing: 'head' },
  { bone: 'LeftShoulder', from: 'shoulderMid', to: 'leftShoulder', strength: 0.25, maxAngle: 0.5, maxTwist: 0.25, smoothing: 'shoulder' },
  { bone: 'RightShoulder', from: 'shoulderMid', to: 'rightShoulder', strength: 0.25, maxAngle: 0.5, maxTwist: 0.25, smoothing: 'shoulder' },
  { bone: 'LeftArm', from: 'leftShoulder', to: 'leftElbow', strength: 1, maxAngle: 2.35, maxTwist: 0.65, smoothing: 'upperArm' },
  { bone: 'LeftForeArm', from: 'leftElbow', to: 'leftWrist', strength: 1, maxAngle: 2.1, maxTwist: 0.45, smoothing: 'foreArm' },
  { bone: 'RightArm', from: 'rightShoulder', to: 'rightElbow', strength: 1, maxAngle: 2.35, maxTwist: 0.65, smoothing: 'upperArm' },
  { bone: 'RightForeArm', from: 'rightElbow', to: 'rightWrist', strength: 1, maxAngle: 2.1, maxTwist: 0.45, smoothing: 'foreArm' },
  { bone: 'LeftUpLeg', from: 'leftHip', to: 'leftKnee', strength: 1, maxAngle: 2.05, maxTwist: 0.38, smoothing: 'upperLeg' },
  { bone: 'LeftLeg', from: 'leftKnee', to: 'leftAnkle', strength: 1, maxAngle: 1.95, maxTwist: 0.32, smoothing: 'lowerLeg' },
  { bone: 'LeftFoot', from: 'leftAnkle', to: 'leftFootIndex', strength: 0.7, maxAngle: 1.15, maxTwist: 0.28, smoothing: 'foot' },
  { bone: 'RightUpLeg', from: 'rightHip', to: 'rightKnee', strength: 1, maxAngle: 2.05, maxTwist: 0.38, smoothing: 'upperLeg' },
  { bone: 'RightLeg', from: 'rightKnee', to: 'rightAnkle', strength: 1, maxAngle: 1.95, maxTwist: 0.32, smoothing: 'lowerLeg' },
  { bone: 'RightFoot', from: 'rightAnkle', to: 'rightFootIndex', strength: 0.7, maxAngle: 1.15, maxTwist: 0.28, smoothing: 'foot' },
];

const BODY_VALIDATION_SEGMENTS = [
  { name: 'torso', group: 'torso', bone: 'Spine2', from: 'hipMid', to: 'shoulderMid' },
  { name: 'neck', group: 'torso', bone: 'Neck', from: 'shoulderMid', to: 'nose' },
  { name: 'leftUpperArm', group: 'arms', bone: 'LeftArm', from: 'leftShoulder', to: 'leftElbow' },
  { name: 'leftForeArm', group: 'arms', bone: 'LeftForeArm', from: 'leftElbow', to: 'leftWrist' },
  { name: 'rightUpperArm', group: 'arms', bone: 'RightArm', from: 'rightShoulder', to: 'rightElbow' },
  { name: 'rightForeArm', group: 'arms', bone: 'RightForeArm', from: 'rightElbow', to: 'rightWrist' },
  { name: 'leftUpperLeg', group: 'legs', bone: 'LeftUpLeg', from: 'leftHip', to: 'leftKnee' },
  { name: 'leftLowerLeg', group: 'legs', bone: 'LeftLeg', from: 'leftKnee', to: 'leftAnkle' },
  { name: 'rightUpperLeg', group: 'legs', bone: 'RightUpLeg', from: 'rightHip', to: 'rightKnee' },
  { name: 'rightLowerLeg', group: 'legs', bone: 'RightLeg', from: 'rightKnee', to: 'rightAnkle' },
];

const BODY_VISUAL_JOINTS = [
  { name: 'leftShoulder', group: 'torso', source: 'leftShoulder', avatarBone: 'LeftArm' },
  { name: 'rightShoulder', group: 'torso', source: 'rightShoulder', avatarBone: 'RightArm' },
  { name: 'leftElbow', group: 'arms', source: 'leftElbow', avatarBone: 'LeftForeArm' },
  { name: 'rightElbow', group: 'arms', source: 'rightElbow', avatarBone: 'RightForeArm' },
  { name: 'leftWrist', group: 'arms', source: 'leftWrist', avatarBone: 'LeftHand' },
  { name: 'rightWrist', group: 'arms', source: 'rightWrist', avatarBone: 'RightHand' },
  { name: 'leftHip', group: 'torso', source: 'leftHip', avatarBone: 'LeftUpLeg' },
  { name: 'rightHip', group: 'torso', source: 'rightHip', avatarBone: 'RightUpLeg' },
  { name: 'leftKnee', group: 'legs', source: 'leftKnee', avatarBone: 'LeftLeg' },
  { name: 'rightKnee', group: 'legs', source: 'rightKnee', avatarBone: 'RightLeg' },
  { name: 'leftAnkle', group: 'legs', source: 'leftAnkle', avatarBone: 'LeftFoot' },
  { name: 'rightAnkle', group: 'legs', source: 'rightAnkle', avatarBone: 'RightFoot' },
];

const SCREEN_LENGTH_CALIBRATION_SEGMENTS = [
  { bone: 'LeftArm', sourceFrom: 'shoulderMid', sourceTo: 'leftShoulder', avatarFrom: 'shoulderMid', avatarTo: 'leftShoulder' },
  { bone: 'RightArm', sourceFrom: 'shoulderMid', sourceTo: 'rightShoulder', avatarFrom: 'shoulderMid', avatarTo: 'rightShoulder' },
  { bone: 'LeftUpLeg', sourceFrom: 'hipMid', sourceTo: 'leftHip', avatarFrom: 'hipMid', avatarTo: 'leftHip' },
  { bone: 'RightUpLeg', sourceFrom: 'hipMid', sourceTo: 'rightHip', avatarFrom: 'hipMid', avatarTo: 'rightHip' },
  { bone: 'LeftForeArm', sourceFrom: 'leftShoulder', sourceTo: 'leftElbow', avatarFrom: 'leftShoulder', avatarTo: 'leftElbow' },
  { bone: 'RightForeArm', sourceFrom: 'rightShoulder', sourceTo: 'rightElbow', avatarFrom: 'rightShoulder', avatarTo: 'rightElbow' },
  { bone: 'LeftHand', sourceFrom: 'leftElbow', sourceTo: 'leftWrist', avatarFrom: 'leftElbow', avatarTo: 'leftWrist', maxScale: MAX_HAND_LENGTH_SCALE },
  { bone: 'RightHand', sourceFrom: 'rightElbow', sourceTo: 'rightWrist', avatarFrom: 'rightElbow', avatarTo: 'rightWrist', maxScale: MAX_HAND_LENGTH_SCALE },
  { bone: 'LeftLeg', sourceFrom: 'leftHip', sourceTo: 'leftKnee', avatarFrom: 'leftHip', avatarTo: 'leftKnee' },
  { bone: 'RightLeg', sourceFrom: 'rightHip', sourceTo: 'rightKnee', avatarFrom: 'rightHip', avatarTo: 'rightKnee' },
  { bone: 'LeftFoot', sourceFrom: 'leftKnee', sourceTo: 'leftAnkle', avatarFrom: 'leftKnee', avatarTo: 'leftAnkle' },
  { bone: 'RightFoot', sourceFrom: 'rightKnee', sourceTo: 'rightAnkle', avatarFrom: 'rightKnee', avatarTo: 'rightAnkle' },
];

const FINGER_SEGMENTS = [
  { from: 0, to: 1, fallbackFrom: 0 },
  { from: 1, to: 2, fallbackFrom: 0 },
  { from: 2, to: 3, fallbackFrom: 1 },
  { from: 3, to: 4, fallbackFrom: 2 },
];

const tmpVectorA = new THREE.Vector3();
const tmpVectorB = new THREE.Vector3();
const tmpVectorC = new THREE.Vector3();
const tmpVectorD = new THREE.Vector3();
const tmpVectorE = new THREE.Vector3();
const tmpVectorF = new THREE.Vector3();
const tmpSize = new THREE.Vector2();
const tmpQuaternionA = new THREE.Quaternion();
const tmpQuaternionB = new THREE.Quaternion();
const tmpQuaternionC = new THREE.Quaternion();
const tmpQuaternionD = new THREE.Quaternion();
const tmpQuaternionE = new THREE.Quaternion();
const tmpQuaternionF = new THREE.Quaternion();
const tmpMatrixA = new THREE.Matrix4();
const tmpMatrixB = new THREE.Matrix4();
const tmpSpherical = new THREE.Spherical();

export function createAvatarRenderer(options = {}) {
  const canvas = options.canvas ?? null;
  const statusElement = options.statusElement ?? null;
  const boneCountElement = options.boneCountElement ?? null;
  const modelUrl = options.modelUrl ?? DEFAULT_MODEL_URL;

  let renderer = null;
  let scene = null;
  let camera = null;
  let model = null;
  let skeletonHelper = null;
  let environmentTexture = null;
  let contactShadow = null;
  let animationFrameId = null;
  let initPromise = null;
  let disposed = false;
  let ready = false;
  let failed = false;
  let lastUpdateTime = 0;
  let skeletonVisible = Boolean(options.showSkeleton);
  let landmarkDepthScale = normalizeDepthScale(options.depthScale ?? DEFAULT_LANDMARK_DEPTH_SCALE);
  let orbitControlsAttached = false;
  const orbitCamera = {
    target: new THREE.Vector3(0, 1, 0),
    radius: 3.1,
    minRadius: 1,
    maxRadius: 8,
    theta: 0,
    phi: Math.PI / 2,
    defaultRadius: 3.1,
    defaultTheta: 0,
    defaultPhi: Math.PI / 2,
  };
  const orbitPointer = {
    id: null,
    x: 0,
    y: 0,
  };

  const bones = new Map();
  const restPose = new Map();
  const bodyBoneNames = new Set();
  const fingerChains = {
    Left: new Map(),
    Right: new Map(),
  };
  const proportionCalibration = {
    frames: 0,
    frozen: false,
    sums: new Map(),
    counts: new Map(),
    lastAppliedCount: 0,
    lastMaxScaleDelta: 0,
  };
  const performanceStats = {
    updateMs: [],
    renderMs: [],
    validationMs: [],
  };

  async function init() {
    if (disposed) {
      return api;
    }

    if (ready) {
      startAnimationLoop();
      return api;
    }

    if (initPromise) {
      return initPromise;
    }

    initPromise = initInternal().finally(() => {
      initPromise = null;
    });

    return initPromise;
  }

  async function initInternal() {
    try {
      setStatus('Loading avatar');
      setBoneCount(0);
      ensureCanvas(canvas);
      createScene();
      await loadModel();
      createSkeletonOverlay();
      discoverBones();
      validateRequiredBones();
      cacheRestPose();
      buildRetargetMaps();
      frameModel();
      resize();
      ready = true;
      failed = false;
      setStatus('Ready');
      setBoneCount(bones.size);
      startAnimationLoop();
    } catch (error) {
      fail(error);
    }

    return api;
  }

  function update({ poseResults = null, handResults = null, mirrored = false, timestamp = 0 } = {}) {
    if (!ready || failed || disposed) {
      return;
    }

    const startedAt = nowMs();

    try {
      const delta = updateDelta(timestamp);
      const relaxAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.relax);
      const poseLandmarks = extractPoseLandmarks(poseResults);
      const worldLandmarks = extractWorldPoseLandmarks(poseResults);
      const hands = extractHands(handResults, mirrored);

      if (poseLandmarks) {
        applyPose(poseLandmarks, mirrored, delta, worldLandmarks);
        applyScreenSpaceProportionCalibration(poseLandmarks, mirrored);
      } else {
        relaxBody(relaxAlpha * 0.45);
      }

      applyHands(hands, mirrored, delta);
    } catch (error) {
      // Bad detector payloads should not break the camera loop.
      console.warn('Avatar update skipped', error);
    } finally {
      recordPerformanceSample(performanceStats.updateMs, nowMs() - startedAt);
    }
  }

  function getBodyValidationSnapshot(options = {}) {
    const startedAt = nowMs();

    try {
      return getBodyValidationSnapshotInternal(options);
    } finally {
      recordPerformanceSample(performanceStats.validationMs, nowMs() - startedAt);
    }
  }

  function getBodyValidationSnapshotInternal({ poseResults = null, mirrored = false, timestamp = 0 } = {}) {
    if (!ready || failed || disposed) {
      return {
        ready: false,
        timestamp,
        segments: [],
        summary: summarizeValidationSegments([]),
      };
    }

    const poseLandmarks = extractPoseLandmarks(poseResults);
    const worldLandmarks = extractWorldPoseLandmarks(poseResults);

    if (!poseLandmarks) {
      return {
        ready: true,
        timestamp,
        segments: [],
        summary: summarizeValidationSegments([]),
      };
    }

    model?.updateWorldMatrix(true, true);
    const points = buildPosePoints(poseLandmarks, mirrored, {
      depthScale: landmarkDepthScale,
      worldLandmarks,
    });
    const segments = BODY_VALIDATION_SEGMENTS
      .map((segment) => getValidationSegment(segment, points))
      .filter(Boolean);

    return {
      ready: true,
      timestamp,
      segments,
      summary: summarizeValidationSegments(segments),
    };
  }

  function getProjectedBodyPoseSnapshot(options = {}) {
    const startedAt = nowMs();

    try {
      return getProjectedBodyPoseSnapshotInternal(options);
    } finally {
      recordPerformanceSample(performanceStats.validationMs, nowMs() - startedAt);
    }
  }

  function getProjectedBodyPoseSnapshotInternal({ poseResults = null, mirrored = false, timestamp = 0 } = {}) {
    if (!ready || failed || disposed || !camera) {
      return {
        ready: false,
        timestamp,
        joints: [],
        summary: summarizeVisualJoints([]),
      };
    }

    const poseLandmarks = extractPoseLandmarks(poseResults);

    if (!poseLandmarks) {
      return {
        ready: true,
        timestamp,
        joints: [],
        summary: summarizeVisualJoints([]),
      };
    }

    model?.updateWorldMatrix(true, true);
    const sourcePoints = buildPosePoints2D(poseLandmarks, mirrored);
    const avatarPoints = buildAvatarProjectedPoints();
    const sourceNormalized = normalizePose2D(sourcePoints);
    const avatarNormalized = normalizePose2D(avatarPoints);
    const joints = BODY_VISUAL_JOINTS
      .map((joint) => {
        const source = sourceNormalized.points[joint.source];
        const avatar = avatarNormalized.points[joint.source];

        if (!source || !avatar) {
          return null;
        }

        return {
          name: joint.name,
          group: joint.group,
          source: pointToArray(source),
          avatar: pointToArray(avatar),
          error: distance2D(source, avatar),
        };
      })
      .filter(Boolean);

    return {
      ready: true,
      timestamp,
      joints,
      summary: summarizeVisualJoints(joints),
      scale: {
        source: sourceNormalized.scale,
        avatar: avatarNormalized.scale,
      },
    };
  }

  function getDepthValidationSnapshot(options = {}) {
    const startedAt = nowMs();

    try {
      return getDepthValidationSnapshotInternal(options);
    } finally {
      recordPerformanceSample(performanceStats.validationMs, nowMs() - startedAt);
    }
  }

  function getDepthValidationSnapshotInternal({ poseResults = null, mirrored = false, timestamp = 0 } = {}) {
    if (!ready || failed || disposed) {
      return {
        ready: false,
        timestamp,
        depthScale: landmarkDepthScale,
        segments: [],
        summary: summarizeDepthValidationSegments([]),
      };
    }

    const poseLandmarks = extractPoseLandmarks(poseResults);
    const worldLandmarks = extractWorldPoseLandmarks(poseResults);

    if (!poseLandmarks) {
      return {
        ready: true,
        timestamp,
        depthScale: landmarkDepthScale,
        segments: [],
        summary: summarizeDepthValidationSegments([]),
      };
    }

    model?.updateWorldMatrix(true, true);
    const referencePoints = buildPosePoints(poseLandmarks, mirrored, {
      depthScale: DEPTH_REFERENCE_SCALE,
      worldLandmarks,
    });
    const flatPoints = buildPosePoints(poseLandmarks, mirrored, {
      depthScale: 0,
      worldLandmarks,
    });
    const segments = BODY_VALIDATION_SEGMENTS
      .map((segment) => getDepthValidationSegment(segment, referencePoints, flatPoints))
      .filter(Boolean);

    return {
      ready: true,
      timestamp,
      depthScale: landmarkDepthScale,
      referenceDepthScale: DEPTH_REFERENCE_SCALE,
      selfReferential: Math.abs(landmarkDepthScale - DEPTH_REFERENCE_SCALE) < 0.000001,
      measurementMode: Math.abs(landmarkDepthScale - DEPTH_REFERENCE_SCALE) < 0.000001
        ? 'retarget_residual_against_same_mediapipe_depth_signal'
        : 'candidate_depth_scale_against_mediapipe_depth_reference',
      depthSource: worldLandmarks ? 'worldLandmarks' : 'landmark.z',
      segments,
      summary: summarizeDepthValidationSegments(segments),
    };
  }

  function resetPose() {
    resetProportionCalibration();
    restoreRestPose(1);
  }

  function resetView() {
    resetOrbitCamera();
    return getViewState();
  }

  function getViewState() {
    return {
      target: vectorToArray(orbitCamera.target),
      radius: orbitCamera.radius,
      theta: orbitCamera.theta,
      phi: orbitCamera.phi,
    };
  }

  function setDepthScale(value) {
    landmarkDepthScale = normalizeDepthScale(value);
    return landmarkDepthScale;
  }

  function getDepthScale() {
    return landmarkDepthScale;
  }

  function getPerformanceSnapshot() {
    return {
      budgetsMs: { ...PERFORMANCE_BUDGETS_MS },
      samples: {
        update: summarizePerformanceSamples(performanceStats.updateMs),
        render: summarizePerformanceSamples(performanceStats.renderMs),
        validation: summarizePerformanceSamples(performanceStats.validationMs),
      },
      calibration: {
        frames: proportionCalibration.frames,
        frozen: proportionCalibration.frozen,
        appliedSegments: proportionCalibration.lastAppliedCount,
        maxScaleDelta: proportionCalibration.lastMaxScaleDelta,
      },
    };
  }

  function clearPerformanceSamples() {
    performanceStats.updateMs.length = 0;
    performanceStats.renderMs.length = 0;
    performanceStats.validationMs.length = 0;
    return getPerformanceSnapshot();
  }

  function setSkeletonVisible(value) {
    skeletonVisible = Boolean(value);

    if (skeletonHelper) {
      skeletonHelper.visible = skeletonVisible;
    }
  }

  function resize() {
    if (!renderer || !camera || !canvas || disposed) {
      return;
    }

    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 1));
    const current = renderer.getSize(tmpSize);

    if (current.x !== width || current.y !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function dispose() {
    disposed = true;
    stopAnimationLoop();
    detachOrbitControls();
    ready = false;
    initPromise = null;

    disposeSkeletonHelper();
    disposeContactShadow();
    disposeModelResources(model);
    disposeEnvironmentTexture();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    model = null;
    skeletonHelper = null;
    contactShadow = null;
    bones.clear();
    restPose.clear();
    bodyBoneNames.clear();
    fingerChains.Left.clear();
    fingerChains.Right.clear();
    resetProportionCalibration();
  }

  function getValidationSegment(segment, points) {
    const bone = getBone(segment.bone);
    const rest = bone ? restPose.get(bone.name) : null;
    const from = points[segment.from];
    const to = points[segment.to];

    if (!bone || !rest || !from || !to) {
      return null;
    }

    const targetDirection = new THREE.Vector3().subVectors(to, from);

    if (targetDirection.lengthSq() < 0.000001) {
      return null;
    }

    const avatarDirection = rest.axisLocal
      .clone()
      .normalize()
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const normalizedTargetDirection = targetDirection.normalize();
    const errorDeg = THREE.MathUtils.radToDeg(avatarDirection.angleTo(normalizedTargetDirection));

    return {
      name: segment.name,
      group: segment.group,
      bone: segment.bone,
      from: segment.from,
      to: segment.to,
      errorDeg,
      targetDirection: vectorToArray(normalizedTargetDirection),
      avatarDirection: vectorToArray(avatarDirection),
    };
  }

  function getDepthValidationSegment(segment, referencePoints, flatPoints) {
    const bone = getBone(segment.bone);
    const rest = bone ? restPose.get(bone.name) : null;
    const referenceFrom = referencePoints[segment.from];
    const referenceTo = referencePoints[segment.to];
    const flatFrom = flatPoints[segment.from];
    const flatTo = flatPoints[segment.to];

    if (!bone || !rest || !referenceFrom || !referenceTo || !flatFrom || !flatTo) {
      return null;
    }

    const targetDirection = new THREE.Vector3().subVectors(referenceTo, referenceFrom);
    const flatDirection = new THREE.Vector3().subVectors(flatTo, flatFrom);

    if (targetDirection.lengthSq() < 0.000001 || flatDirection.lengthSq() < 0.000001) {
      return null;
    }

    const avatarDirection = rest.axisLocal
      .clone()
      .normalize()
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const normalizedTargetDirection = targetDirection.clone().normalize();
    const normalizedFlatDirection = flatDirection.clone().normalize();
    const errorDeg = THREE.MathUtils.radToDeg(avatarDirection.angleTo(normalizedTargetDirection));
    const flatSourceErrorDeg = THREE.MathUtils.radToDeg(
      normalizedFlatDirection.angleTo(normalizedTargetDirection),
    );
    const sourceDepthRatio = Math.abs(targetDirection.z) / Math.max(flatDirection.length(), 0.0001);
    const depthSalient = sourceDepthRatio >= DEPTH_SALIENT_Z_RATIO;

    return {
      name: segment.name,
      group: segment.group,
      bone: segment.bone,
      from: segment.from,
      to: segment.to,
      errorDeg,
      flatSourceErrorDeg,
      sourceDepthRatio,
      sourceDepthDelta: targetDirection.z,
      depthSalient,
      matched: errorDeg <= DEPTH_MATCH_THRESHOLD_DEG,
      matchThresholdDeg: DEPTH_MATCH_THRESHOLD_DEG,
      targetDirection: vectorToArray(normalizedTargetDirection),
      flatDirection: vectorToArray(normalizedFlatDirection),
      avatarDirection: vectorToArray(avatarDirection),
    };
  }

  function buildAvatarProjectedPoints() {
    const points = Object.fromEntries(
      BODY_VISUAL_JOINTS.map((joint) => [
        joint.source,
        projectBonePoint(getBone(joint.avatarBone)),
      ]),
    );

    points.shoulderMid = midpoint2D(points.leftShoulder, points.rightShoulder);
    points.hipMid = midpoint2D(points.leftHip, points.rightHip);

    return points;
  }

  function projectBonePoint(bone) {
    if (!bone || !camera) {
      return null;
    }

    const projected = bone
      .getWorldPosition(new THREE.Vector3())
      .project(camera);

    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return null;
    }

    return {
      x: (projected.x + 1) / 2,
      y: (1 - projected.y) / 2,
    };
  }

  function createScene() {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));

    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearAlpha?.(0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    camera.position.set(0, 1.35, 3.1);

    const environment = new RoomEnvironment(renderer);
    const pmrem = new THREE.PMREMGenerator(renderer);
    environmentTexture = pmrem.fromScene(environment, 0.04).texture;
    scene.environment = environmentTexture;
    environment.dispose();
    pmrem.dispose();

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x40485a, 1.05);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(1.2, 2.8, 2.2);
    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 0.35);
    fillLight.position.set(-1.6, 1.5, -1.3);
    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
    rimLight.position.set(-1.8, 2.2, 2.4);

    scene.add(hemisphereLight, keyLight, fillLight, rimLight);
    attachOrbitControls();
  }

  async function loadModel() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(modelUrl);

    if (!gltf?.scene) {
      throw new Error('model scene not found');
    }

    model = gltf.scene;
    model.traverse((object) => {
      if (object.isMesh) {
        object.frustumCulled = false;
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    scene.add(model);
  }

  function createSkeletonOverlay() {
    if (!model || !scene) {
      return;
    }

    skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.visible = skeletonVisible;
    skeletonHelper.frustumCulled = false;
    skeletonHelper.renderOrder = 20;

    if (skeletonHelper.material) {
      skeletonHelper.material.depthTest = false;
      skeletonHelper.material.transparent = true;
      skeletonHelper.material.opacity = 0.95;
    }

    scene.add(skeletonHelper);
  }

  function discoverBones() {
    bones.clear();

    model.traverse((object) => {
      if (object.isBone && isMixamoBoneName(object.name)) {
        for (const alias of boneNameAliases(object.name)) {
          bones.set(alias, object);
        }
      }
    });

    if (bones.size === 0) {
      throw new Error(`no ${BONE_PREFIX} bones found`);
    }
  }

  function validateRequiredBones() {
    const missing = REQUIRED_BONES.filter((name) => !getBone(name));

    if (missing.length > 0) {
      throw new Error(`missing required avatar bones: ${missing.slice(0, 8).join(', ')}`);
    }
  }

  function cacheRestPose() {
    restPose.clear();
    model.updateWorldMatrix(true, true);

    for (const [name, bone] of bones) {
      const axisLocal = inferBoneAxisLocal(bone);
      restPose.set(name, {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone(),
        axisLocal,
        secondaryAxisLocal: inferSecondaryAxisLocal(axisLocal),
      });
    }
  }

  function buildRetargetMaps() {
    bodyBoneNames.clear();
    BODY_RETARGETS.forEach(({ bone }) => {
      if (getBone(bone)) {
        bodyBoneNames.add(boneName(bone));
      }
    });

    for (const side of ['Left', 'Right']) {
      fingerChains[side].clear();

      for (const fingerName of Object.keys(HAND_FINGERS)) {
        const chain = [1, 2, 3, 4]
          .map((segment) => getBone(`${side}Hand${fingerName}${segment}`))
          .filter(Boolean);
        fingerChains[side].set(fingerName, chain);
      }
    }
  }

  function frameModel() {
    const box = new THREE.Box3().setFromObject(model);

    if (box.isEmpty()) {
      configureOrbitCamera(new THREE.Vector3(0, 1, 0), 3.1, 1, 8, 0, Math.PI / 2);
      return;
    }

    const center = box.getCenter(tmpVectorB);
    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;
    model.updateWorldMatrix(true, true);

    const fittedBox = new THREE.Box3().setFromObject(model);
    const fittedSize = fittedBox.getSize(tmpVectorA);
    const height = Math.max(fittedSize.y, 1);
    const maxDimension = Math.max(fittedSize.x, fittedSize.y, fittedSize.z, 1);
    const target = new THREE.Vector3(0, height * 0.56, 0);
    const viewDistance = maxDimension * 1.75;
    const verticalOffset = height * 0.58 - target.y;
    const defaultRadius = Math.max(Math.hypot(viewDistance, verticalOffset), 0.1);
    const defaultPhi = Math.acos(THREE.MathUtils.clamp(verticalOffset / defaultRadius, -1, 1));

    camera.near = Math.max(0.01, maxDimension / 100);
    camera.far = Math.max(100, maxDimension * 10);
    camera.updateProjectionMatrix();
    createContactShadow(maxDimension);
    configureOrbitCamera(
      target,
      defaultRadius,
      defaultRadius * ORBIT_MIN_DISTANCE_SCALE,
      defaultRadius * ORBIT_MAX_DISTANCE_SCALE,
      0,
      defaultPhi,
    );
  }

  function createContactShadow(maxDimension) {
    if (!scene) {
      return;
    }

    disposeContactShadow();
    const width = Math.max(maxDimension * 0.58, 0.4);
    const depth = Math.max(maxDimension * 0.18, 0.16);
    const geometry = new THREE.PlaneGeometry(width, depth);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    contactShadow = new THREE.Mesh(geometry, material);
    contactShadow.name = 'AvatarContactShadow';
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.012, 0.08);
    contactShadow.renderOrder = -1;
    scene.add(contactShadow);
  }

  function configureOrbitCamera(target, radius, minRadius, maxRadius, theta, phi) {
    orbitCamera.target.copy(target);
    orbitCamera.radius = radius;
    orbitCamera.minRadius = minRadius;
    orbitCamera.maxRadius = maxRadius;
    orbitCamera.theta = theta;
    orbitCamera.phi = THREE.MathUtils.clamp(phi, ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
    orbitCamera.defaultRadius = radius;
    orbitCamera.defaultTheta = theta;
    orbitCamera.defaultPhi = orbitCamera.phi;
    applyOrbitCamera();
  }

  function resetOrbitCamera() {
    orbitCamera.radius = orbitCamera.defaultRadius;
    orbitCamera.theta = orbitCamera.defaultTheta;
    orbitCamera.phi = orbitCamera.defaultPhi;
    applyOrbitCamera();
  }

  function applyOrbitCamera() {
    if (!camera) {
      return;
    }

    tmpSpherical.set(orbitCamera.radius, orbitCamera.phi, orbitCamera.theta);
    camera.position.setFromSpherical(tmpSpherical).add(orbitCamera.target);
    camera.lookAt(orbitCamera.target);
    camera.updateMatrixWorld(true);
  }

  function attachOrbitControls() {
    if (!canvas || orbitControlsAttached) {
      return;
    }

    canvas.addEventListener('pointerdown', handleOrbitPointerDown);
    canvas.addEventListener('pointermove', handleOrbitPointerMove);
    canvas.addEventListener('pointerup', handleOrbitPointerEnd);
    canvas.addEventListener('pointercancel', handleOrbitPointerEnd);
    canvas.addEventListener('lostpointercapture', handleOrbitPointerEnd);
    canvas.addEventListener('wheel', handleOrbitWheel, { passive: false });
    canvas.addEventListener('dblclick', handleOrbitDoubleClick);
    orbitControlsAttached = true;
  }

  function detachOrbitControls() {
    if (!canvas || !orbitControlsAttached) {
      return;
    }

    canvas.removeEventListener('pointerdown', handleOrbitPointerDown);
    canvas.removeEventListener('pointermove', handleOrbitPointerMove);
    canvas.removeEventListener('pointerup', handleOrbitPointerEnd);
    canvas.removeEventListener('pointercancel', handleOrbitPointerEnd);
    canvas.removeEventListener('lostpointercapture', handleOrbitPointerEnd);
    canvas.removeEventListener('wheel', handleOrbitWheel);
    canvas.removeEventListener('dblclick', handleOrbitDoubleClick);
    canvas.classList.remove('is-orbiting');
    orbitPointer.id = null;
    orbitControlsAttached = false;
  }

  function handleOrbitPointerDown(event) {
    if (!camera || disposed || failed || event.button !== 0) {
      return;
    }

    event.preventDefault();
    orbitPointer.id = event.pointerId;
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;
    setOrbitPointerCapture(event.pointerId);
    canvas?.classList.add('is-orbiting');
  }

  function handleOrbitPointerMove(event) {
    if (orbitPointer.id !== event.pointerId || !camera) {
      return;
    }

    event.preventDefault();
    const dx = event.clientX - orbitPointer.x;
    const dy = event.clientY - orbitPointer.y;
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;

    orbitCamera.theta -= dx * ORBIT_ROTATE_SPEED;
    orbitCamera.phi = THREE.MathUtils.clamp(
      orbitCamera.phi - dy * ORBIT_ROTATE_SPEED,
      ORBIT_MIN_POLAR,
      ORBIT_MAX_POLAR,
    );
    applyOrbitCamera();
  }

  function handleOrbitPointerEnd(event) {
    if (orbitPointer.id !== event.pointerId) {
      return;
    }

    releaseOrbitPointerCapture(event.pointerId);
    canvas?.classList.remove('is-orbiting');
    orbitPointer.id = null;
  }

  function setOrbitPointerCapture(pointerId) {
    try {
      canvas?.setPointerCapture?.(pointerId);
    } catch {
      // Programmatic tests can dispatch pointer events without a browser-owned active pointer.
    }
  }

  function releaseOrbitPointerCapture(pointerId) {
    try {
      canvas?.releasePointerCapture?.(pointerId);
    } catch {
      // Ignore unmatched synthetic pointer releases; real pointer interaction remains captured.
    }
  }

  function handleOrbitWheel(event) {
    if (!camera || disposed || failed) {
      return;
    }

    event.preventDefault();
    const zoomFactor = Math.exp(event.deltaY * ORBIT_ZOOM_SPEED);
    orbitCamera.radius = THREE.MathUtils.clamp(
      orbitCamera.radius * zoomFactor,
      orbitCamera.minRadius,
      orbitCamera.maxRadius,
    );
    applyOrbitCamera();
  }

  function handleOrbitDoubleClick(event) {
    event.preventDefault();
    resetOrbitCamera();
  }

  function applyPose(landmarks, mirrored, delta, worldLandmarks = null) {
    const points = buildPosePoints(landmarks, mirrored, {
      depthScale: landmarkDepthScale,
      worldLandmarks,
    });
    const secondaryNormals = computeLimbPlaneNormals(points);

    for (const target of BODY_RETARGETS) {
      const from = points[target.from];
      const to = points[target.to];

      if (!from || !to) {
        continue;
      }

      const direction = tmpVectorC.subVectors(to, from);
      const alpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS[target.smoothing] ?? RETARGET_SMOOTHING_MS.foreArm);
      applyAimToBone(target.bone, direction, alpha * target.strength, target.maxAngle, {
        maxTwist: target.maxTwist,
        secondaryWorld: secondaryNormals[target.bone] ?? null,
      });
    }
  }

  function applyScreenSpaceProportionCalibration(landmarks, mirrored) {
    if (!model || !camera || proportionCalibration.frozen) {
      return;
    }

    model.updateWorldMatrix(true, true);

    const sourceNormalized = normalizePose2D(buildPosePoints2D(landmarks, mirrored));
    const avatarNormalized = normalizePose2D(buildAvatarProjectedPoints());
    let validSegments = 0;

    for (const segment of SCREEN_LENGTH_CALIBRATION_SEGMENTS) {
      const bone = getBone(segment.bone);
      const rest = bone ? restPose.get(bone.name) : null;
      const sourceFrom = sourceNormalized.points[segment.sourceFrom];
      const sourceTo = sourceNormalized.points[segment.sourceTo];
      const avatarFrom = avatarNormalized.points[segment.avatarFrom];
      const avatarTo = avatarNormalized.points[segment.avatarTo];

      if (!bone || !rest || !sourceFrom || !sourceTo || !avatarFrom || !avatarTo) {
        continue;
      }

      const sourceLength = distance2D(sourceFrom, sourceTo);
      const avatarLength = distance2D(avatarFrom, avatarTo);

      if (sourceLength < 0.0001 || avatarLength < 0.0001 || rest.position.lengthSq() < 0.000001) {
        continue;
      }

      const targetScale = clamp(
        sourceLength / avatarLength,
        MIN_BONE_LENGTH_SCALE,
        segment.maxScale ?? MAX_BONE_LENGTH_SCALE,
      );
      recordProportionCalibrationSample(bone.name, targetScale);
      validSegments += 1;
    }

    if (validSegments >= PROPORTION_CALIBRATION_MIN_SEGMENTS) {
      proportionCalibration.frames += 1;
    }

    if (proportionCalibration.frames >= PROPORTION_CALIBRATION_FRAMES) {
      freezeProportionCalibration();
    }
  }

  function recordProportionCalibrationSample(boneNameKey, scale) {
    proportionCalibration.sums.set(
      boneNameKey,
      (proportionCalibration.sums.get(boneNameKey) ?? 0) + scale,
    );
    proportionCalibration.counts.set(
      boneNameKey,
      (proportionCalibration.counts.get(boneNameKey) ?? 0) + 1,
    );
  }

  function freezeProportionCalibration() {
    if (proportionCalibration.frozen) {
      return;
    }

    let appliedCount = 0;
    let maxScaleDelta = 0;

    for (const [boneNameKey, sum] of proportionCalibration.sums) {
      const count = proportionCalibration.counts.get(boneNameKey) ?? 0;
      const bone = bones.get(boneNameKey);
      const rest = bone ? restPose.get(bone.name) : null;

      if (!bone || !rest || count < Math.max(4, PROPORTION_CALIBRATION_FRAMES / 4)) {
        continue;
      }

      const averageScale = clamp(sum / count, MIN_BONE_LENGTH_SCALE, MAX_HAND_LENGTH_SCALE);
      bone.position.copy(rest.position).multiplyScalar(averageScale);
      bone.updateMatrixWorld(true);
      appliedCount += 1;
      maxScaleDelta = Math.max(maxScaleDelta, Math.abs(averageScale - 1));
    }

    proportionCalibration.lastAppliedCount = appliedCount;
    proportionCalibration.lastMaxScaleDelta = maxScaleDelta;
    proportionCalibration.frozen = true;
    proportionCalibration.sums.clear();
    proportionCalibration.counts.clear();
  }

  function resetProportionCalibration() {
    proportionCalibration.frames = 0;
    proportionCalibration.frozen = false;
    proportionCalibration.lastAppliedCount = 0;
    proportionCalibration.lastMaxScaleDelta = 0;
    proportionCalibration.sums.clear();
    proportionCalibration.counts.clear();
  }

  function applyHands(hands, mirrored, delta) {
    const usedSides = new Set();
    const relaxAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.relax);

    for (const hand of hands) {
      const side = resolveHandSide(hand, mirrored, usedSides);

      if (!side) {
        continue;
      }

      usedSides.add(side);
      applyHand(side, hand.landmarks, mirrored, delta);
    }

    for (const side of ['Left', 'Right']) {
      if (!usedSides.has(side)) {
        relaxHand(side, relaxAlpha * 0.4);
      }
    }
  }

  function applyHand(side, landmarks, mirrored, delta) {
    const points = landmarks.map((landmark) => landmarkToVector(landmark, mirrored));
    const wrist = points[0];
    const indexBase = points[5];
    const middleBase = points[9];
    const pinkyBase = points[17];
    const handAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.hand);
    const fingerAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.finger);
    const palmNormal = computePalmNormal(wrist, indexBase, pinkyBase);

    if (wrist && middleBase) {
      tmpVectorC.subVectors(middleBase, wrist);
      applyAimToBone(`${side}Hand`, tmpVectorC, handAlpha * 0.65, 1.05, {
        maxTwist: 0.62,
        secondaryWorld: palmNormal,
      });
    }

    for (const [fingerName, indices] of Object.entries(HAND_FINGERS)) {
      const chain = fingerChains[side].get(fingerName) ?? [];

      for (let i = 0; i < Math.min(chain.length, FINGER_SEGMENTS.length); i += 1) {
        const segment = FINGER_SEGMENTS[i];
        const from = points[indices[segment.from] ?? indices[segment.fallbackFrom]];
        const to = points[indices[segment.to]];

        if (!from || !to) {
          continue;
        }

        const spreadStrength = i === 0 ? 1 : 0.75;
        const segmentAlpha = i === 0
          ? smoothingAlpha(delta, RETARGET_SMOOTHING_MS.fingerBase)
          : fingerAlpha;
        tmpVectorC.subVectors(to, from);
        applyAimToBone(chain[i], tmpVectorC, segmentAlpha * spreadStrength, fingerName === 'Thumb' ? 1.1 : 1.25, {
          maxTwist: fingerName === 'Thumb' ? 0.52 : 0.38,
        });
      }
    }
  }

  function computeLimbPlaneNormals(points) {
    return {
      LeftArm: limbPlaneNormal(points.leftShoulder, points.leftElbow, points.leftWrist),
      LeftForeArm: limbPlaneNormal(points.leftShoulder, points.leftElbow, points.leftWrist),
      RightArm: limbPlaneNormal(points.rightShoulder, points.rightElbow, points.rightWrist),
      RightForeArm: limbPlaneNormal(points.rightShoulder, points.rightElbow, points.rightWrist),
      LeftUpLeg: limbPlaneNormal(points.leftHip, points.leftKnee, points.leftAnkle),
      LeftLeg: limbPlaneNormal(points.leftHip, points.leftKnee, points.leftAnkle),
      RightUpLeg: limbPlaneNormal(points.rightHip, points.rightKnee, points.rightAnkle),
      RightLeg: limbPlaneNormal(points.rightHip, points.rightKnee, points.rightAnkle),
    };
  }

  function limbPlaneNormal(root, mid, end) {
    if (!root || !mid || !end) {
      return null;
    }

    const first = tmpVectorA.subVectors(mid, root);
    const second = tmpVectorB.subVectors(end, mid);
    const normal = new THREE.Vector3().crossVectors(first, second);

    return normal.lengthSq() > 0.000001 ? normal.normalize() : null;
  }

  function computePalmNormal(wrist, indexBase, pinkyBase) {
    if (!wrist || !indexBase || !pinkyBase) {
      return null;
    }

    const indexVector = tmpVectorA.subVectors(indexBase, wrist);
    const pinkyVector = tmpVectorB.subVectors(pinkyBase, wrist);
    const normal = new THREE.Vector3().crossVectors(indexVector, pinkyVector);

    return normal.lengthSq() > 0.000001 ? normal.normalize() : null;
  }

  function applyAimToBone(boneOrName, directionWorld, alpha, maxAngle, options = {}) {
    const bone = typeof boneOrName === 'string' ? getBone(boneOrName) : boneOrName;

    if (!bone || directionWorld.lengthSq() < 0.000001) {
      return;
    }

    const rest = restPose.get(bone.name);

    if (!rest) {
      return;
    }

    bone.parent?.updateWorldMatrix(true, false);
    const parentWorldQuaternion = bone.parent
      ? bone.parent.getWorldQuaternion(tmpQuaternionA)
      : tmpQuaternionA.identity();
    const inverseParentWorld = tmpQuaternionB.copy(parentWorldQuaternion).invert();
    const targetDirectionLocal = tmpVectorA.copy(directionWorld).normalize().applyQuaternion(inverseParentWorld).normalize();
    const restDirectionLocal = tmpVectorB.copy(rest.axisLocal).applyQuaternion(rest.quaternion).normalize();
    const targetQuaternion = options.secondaryWorld
      ? applyAimWithSecondary(rest, targetDirectionLocal, options.secondaryWorld, inverseParentWorld)
      : tmpQuaternionD.multiplyQuaternions(
        tmpQuaternionC.setFromUnitVectors(restDirectionLocal, targetDirectionLocal),
        rest.quaternion,
      );
    const angleLimitedTarget = limitFromRest(rest.quaternion, targetQuaternion, maxAngle);
    const limitedTarget = limitTwistFromRest(
      rest.quaternion,
      angleLimitedTarget,
      rest.axisLocal,
      options.maxTwist,
    );

    bone.quaternion.slerp(limitedTarget, clamp01(alpha));
    bone.updateMatrixWorld(true);
  }

  function applyAimWithSecondary(rest, targetDirectionLocal, secondaryWorld, inverseParentWorld) {
    const targetSecondaryLocal = tmpVectorC
      .copy(secondaryWorld)
      .normalize()
      .applyQuaternion(inverseParentWorld)
      .normalize();
    const restDirectionLocal = tmpVectorD.copy(rest.axisLocal).applyQuaternion(rest.quaternion).normalize();
    const restSecondaryLocal = tmpVectorE
      .copy(rest.secondaryAxisLocal)
      .applyQuaternion(rest.quaternion)
      .normalize();

    return tmpQuaternionD.multiplyQuaternions(
      basisQuaternion(targetDirectionLocal, targetSecondaryLocal, tmpMatrixA, tmpQuaternionE),
      basisQuaternion(restDirectionLocal, restSecondaryLocal, tmpMatrixB, tmpQuaternionF).invert(),
    ).multiply(rest.quaternion);
  }

  function basisQuaternion(primary, secondary, matrix, target) {
    const xAxis = tmpVectorD.copy(primary).normalize();
    const yAxis = tmpVectorE.copy(secondary).addScaledVector(xAxis, -secondary.dot(xAxis));

    if (yAxis.lengthSq() < 0.000001) {
      choosePerpendicularAxis(xAxis, yAxis);
    } else {
      yAxis.normalize();
    }

    const zAxis = tmpVectorF.crossVectors(xAxis, yAxis).normalize();
    matrix.makeBasis(xAxis, yAxis, zAxis);
    return target.setFromRotationMatrix(matrix);
  }

  function limitFromRest(restQuaternion, targetQuaternion, maxAngle) {
    if (!Number.isFinite(maxAngle)) {
      return targetQuaternion;
    }

    const angle = restQuaternion.angleTo(targetQuaternion);

    if (angle <= maxAngle) {
      return targetQuaternion;
    }

    return tmpQuaternionB.copy(restQuaternion).slerp(targetQuaternion, maxAngle / angle);
  }

  function limitTwistFromRest(restQuaternion, targetQuaternion, axisLocal, maxTwist) {
    if (!Number.isFinite(maxTwist)) {
      return targetQuaternion;
    }

    const delta = tmpQuaternionC.copy(targetQuaternion).multiply(tmpQuaternionD.copy(restQuaternion).invert());
    const twist = extractTwist(delta, axisLocal, tmpQuaternionE);
    const twistAngle = signedQuaternionAngle(twist);

    if (Math.abs(twistAngle) <= maxTwist) {
      return targetQuaternion;
    }

    const clampedTwist = tmpQuaternionF.setFromAxisAngle(
      tmpVectorA.copy(axisLocal).normalize(),
      clamp(twistAngle, -maxTwist, maxTwist),
    );
    const swing = tmpQuaternionC.copy(delta).multiply(twist.invert());

    return targetQuaternion.copy(swing.multiply(clampedTwist).multiply(restQuaternion));
  }

  function extractTwist(quaternion, axisLocal, target) {
    const axis = tmpVectorA.copy(axisLocal).normalize();
    target.set(
      axis.x * (quaternion.x * axis.x + quaternion.y * axis.y + quaternion.z * axis.z),
      axis.y * (quaternion.x * axis.x + quaternion.y * axis.y + quaternion.z * axis.z),
      axis.z * (quaternion.x * axis.x + quaternion.y * axis.y + quaternion.z * axis.z),
      quaternion.w,
    );

    if (target.lengthSq() < 0.000001) {
      return target.identity();
    }

    return target.normalize();
  }

  function signedQuaternionAngle(quaternion) {
    const angle = 2 * Math.atan2(
      Math.hypot(quaternion.x, quaternion.y, quaternion.z),
      quaternion.w,
    );

    return angle > Math.PI ? angle - Math.PI * 2 : angle;
  }

  function relaxBody(alpha) {
    for (const name of bodyBoneNames) {
      relaxBone(name, alpha);
    }
  }

  function relaxHand(side, alpha) {
    relaxBone(`${side}Hand`, alpha);

    for (const chain of fingerChains[side].values()) {
      for (const bone of chain) {
        relaxBone(bone, alpha);
      }
    }
  }

  function relaxBone(boneOrName, alpha) {
    const bone = typeof boneOrName === 'string' ? getBone(boneOrName) : boneOrName;
    const rest = bone ? restPose.get(bone.name) : null;

    if (!bone || !rest) {
      return;
    }

    bone.quaternion.slerp(rest.quaternion, clamp01(alpha));
    bone.updateMatrixWorld(true);
  }

  function restoreRestPose(alpha) {
    for (const [name, rest] of restPose) {
      const bone = bones.get(name);

      if (!bone) {
        continue;
      }

      bone.position.copy(rest.position);
      bone.quaternion.slerp(rest.quaternion, clamp01(alpha));
      bone.updateMatrixWorld(true);
    }
  }

  function startAnimationLoop() {
    if (animationFrameId !== null || !renderer || !scene || !camera || disposed) {
      return;
    }

    const render = () => {
      animationFrameId = requestAnimationFrame(render);
      resize();
      const startedAt = nowMs();
      renderer.render(scene, camera);
      recordPerformanceSample(performanceStats.renderMs, nowMs() - startedAt);
    };

    animationFrameId = requestAnimationFrame(render);
  }

  function stopAnimationLoop() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function fail(error) {
    failed = true;
    ready = false;
    stopAnimationLoop();
    detachOrbitControls();
    const reason = error instanceof Error ? error.message : String(error);
    setStatus(`Failed: ${reason || 'avatar unavailable'}`);
    setBoneCount(0);
    disposeSkeletonHelper();
    disposeContactShadow();
    disposeModelResources(model);
    disposeEnvironmentTexture();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    model = null;
    skeletonHelper = null;
    contactShadow = null;
    bones.clear();
    restPose.clear();
    resetProportionCalibration();
  }

  function disposeSkeletonHelper() {
    if (!skeletonHelper) {
      return;
    }

    scene?.remove?.(skeletonHelper);
    skeletonHelper.geometry?.dispose?.();
    disposeMaterial(skeletonHelper.material);
    skeletonHelper = null;
  }

  function disposeContactShadow() {
    if (!contactShadow) {
      return;
    }

    scene?.remove?.(contactShadow);
    contactShadow.geometry?.dispose?.();
    disposeMaterial(contactShadow.material);
    contactShadow = null;
  }

  function disposeEnvironmentTexture() {
    environmentTexture?.dispose?.();
    environmentTexture = null;
  }

  function getBone(name) {
    return bones.get(boneName(name)) ?? null;
  }

  function setStatus(message) {
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  function setBoneCount(count) {
    if (boneCountElement) {
      boneCountElement.textContent = String(count);
    }
  }

  function updateDelta(timestamp) {
    const now = Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : globalThis.performance?.now?.() ?? Date.now();
    const delta = lastUpdateTime > 0
      ? Math.max(1, Math.min(100, now - lastUpdateTime))
      : FIRST_UPDATE_DELTA_MS;
    lastUpdateTime = now;
    return delta;
  }

  function smoothingAlpha(delta, smoothingMs) {
    return clamp01(1 - Math.exp(-delta / smoothingMs));
  }

  function recordPerformanceSample(samples, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    samples.push(durationMs);

    if (samples.length > PERFORMANCE_SAMPLE_LIMIT) {
      samples.splice(0, samples.length - PERFORMANCE_SAMPLE_LIMIT);
    }
  }

  function summarizePerformanceSamples(samples) {
    if (samples.length === 0) {
      return {
        count: 0,
        medianMs: 0,
        p95Ms: 0,
        maxMs: 0,
      };
    }

    const sorted = samples.slice().sort((a, b) => a - b);

    return {
      count: samples.length,
      medianMs: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1],
    };
  }

  function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  const api = {
    init,
    update,
    getBodyValidationSnapshot,
    getProjectedBodyPoseSnapshot,
    getDepthValidationSnapshot,
    setSkeletonVisible,
    setDepthScale,
    getDepthScale,
    getPerformanceSnapshot,
    clearPerformanceSamples,
    resetView,
    getViewState,
    resetPose,
    resize,
    dispose,
  };

  return api;
}

function buildPosePoints(landmarks, mirrored, depthOptions = {}) {
  const resolvedDepthOptions = {
    ...depthOptions,
    landmarks,
    worldContext: createWorldDepthContext(landmarks, depthOptions.worldLandmarks),
  };
  const points = {
    nose: posePoint(landmarks, POSE.nose, mirrored, 0.15, resolvedDepthOptions),
    leftEye: posePoint(landmarks, POSE.leftEye, mirrored, 0.1, resolvedDepthOptions),
    rightEye: posePoint(landmarks, POSE.rightEye, mirrored, 0.1, resolvedDepthOptions),
    leftEar: posePoint(landmarks, POSE.leftEar, mirrored, 0.1, resolvedDepthOptions),
    rightEar: posePoint(landmarks, POSE.rightEar, mirrored, 0.1, resolvedDepthOptions),
    leftShoulder: posePoint(landmarks, POSE.leftShoulder, mirrored, 0.2, resolvedDepthOptions),
    rightShoulder: posePoint(landmarks, POSE.rightShoulder, mirrored, 0.2, resolvedDepthOptions),
    leftElbow: posePoint(landmarks, POSE.leftElbow, mirrored, 0.2, resolvedDepthOptions),
    rightElbow: posePoint(landmarks, POSE.rightElbow, mirrored, 0.2, resolvedDepthOptions),
    leftWrist: posePoint(landmarks, POSE.leftWrist, mirrored, 0.2, resolvedDepthOptions),
    rightWrist: posePoint(landmarks, POSE.rightWrist, mirrored, 0.2, resolvedDepthOptions),
    leftHip: posePoint(landmarks, POSE.leftHip, mirrored, 0.2, resolvedDepthOptions),
    rightHip: posePoint(landmarks, POSE.rightHip, mirrored, 0.2, resolvedDepthOptions),
    leftKnee: posePoint(landmarks, POSE.leftKnee, mirrored, 0.2, resolvedDepthOptions),
    rightKnee: posePoint(landmarks, POSE.rightKnee, mirrored, 0.2, resolvedDepthOptions),
    leftAnkle: posePoint(landmarks, POSE.leftAnkle, mirrored, 0.2, resolvedDepthOptions),
    rightAnkle: posePoint(landmarks, POSE.rightAnkle, mirrored, 0.2, resolvedDepthOptions),
    leftFootIndex: posePoint(landmarks, POSE.leftFootIndex, mirrored, 0.1, resolvedDepthOptions),
    rightFootIndex: posePoint(landmarks, POSE.rightFootIndex, mirrored, 0.1, resolvedDepthOptions),
  };

  points.shoulderMid = midpoint(points.leftShoulder, points.rightShoulder);
  points.hipMid = midpoint(points.leftHip, points.rightHip);
  points.eyeMid = midpoint(points.leftEye, points.rightEye) || midpoint(points.leftEar, points.rightEar);

  return points;
}

function buildPosePoints2D(landmarks, mirrored) {
  const points = {
    leftShoulder: posePoint2D(landmarks, POSE.leftShoulder, mirrored),
    rightShoulder: posePoint2D(landmarks, POSE.rightShoulder, mirrored),
    leftElbow: posePoint2D(landmarks, POSE.leftElbow, mirrored),
    rightElbow: posePoint2D(landmarks, POSE.rightElbow, mirrored),
    leftWrist: posePoint2D(landmarks, POSE.leftWrist, mirrored),
    rightWrist: posePoint2D(landmarks, POSE.rightWrist, mirrored),
    leftHip: posePoint2D(landmarks, POSE.leftHip, mirrored),
    rightHip: posePoint2D(landmarks, POSE.rightHip, mirrored),
    leftKnee: posePoint2D(landmarks, POSE.leftKnee, mirrored),
    rightKnee: posePoint2D(landmarks, POSE.rightKnee, mirrored),
    leftAnkle: posePoint2D(landmarks, POSE.leftAnkle, mirrored),
    rightAnkle: posePoint2D(landmarks, POSE.rightAnkle, mirrored),
  };

  points.shoulderMid = midpoint2D(points.leftShoulder, points.rightShoulder);
  points.hipMid = midpoint2D(points.leftHip, points.rightHip);

  return points;
}

function posePoint2D(landmarks, index, mirrored, minVisibility = 0.2) {
  const landmark = landmarks?.[index];

  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  if (Number.isFinite(landmark.visibility) && landmark.visibility < minVisibility) {
    return null;
  }

  return {
    x: mirrored ? 1 - landmark.x : landmark.x,
    y: landmark.y,
  };
}

function extractPoseLandmarks(results) {
  if (!results) {
    return null;
  }

  if (isLandmarkList(results.poseLandmarks)) {
    return results.poseLandmarks;
  }

  if (Array.isArray(results.poseLandmarks) && isLandmarkList(results.poseLandmarks[0])) {
    return results.poseLandmarks[0];
  }

  if (isLandmarkList(results.landmarks)) {
    return results.landmarks;
  }

  if (Array.isArray(results.landmarks) && isLandmarkList(results.landmarks[0])) {
    return results.landmarks[0];
  }

  return null;
}

function extractWorldPoseLandmarks(results) {
  if (!results) {
    return null;
  }

  if (isLandmarkList(results.poseWorldLandmarks)) {
    return results.poseWorldLandmarks;
  }

  if (Array.isArray(results.poseWorldLandmarks) && isLandmarkList(results.poseWorldLandmarks[0])) {
    return results.poseWorldLandmarks[0];
  }

  if (isLandmarkList(results.worldLandmarks)) {
    return results.worldLandmarks;
  }

  if (Array.isArray(results.worldLandmarks) && isLandmarkList(results.worldLandmarks[0])) {
    return results.worldLandmarks[0];
  }

  return null;
}

function extractHands(results, mirrored) {
  if (!results) {
    return [];
  }

  const hands = [];

  if (isLandmarkList(results.leftHandLandmarks)) {
    hands.push({ landmarks: results.leftHandLandmarks, side: 'Left', score: 1 });
  }

  if (isLandmarkList(results.rightHandLandmarks)) {
    hands.push({ landmarks: results.rightHandLandmarks, side: 'Right', score: 1 });
  }

  const landmarkGroups = normalizeHandLandmarkGroups(results);
  const handedness = results.multiHandedness ?? results.handednesses ?? results.handedness ?? [];

  landmarkGroups.forEach((landmarks, index) => {
    if (!isLandmarkList(landmarks)) {
      return;
    }

    const side = normalizeHandLabel(readHandLabel(handedness[index]), mirrored);
    const score = readHandScore(handedness[index]);
    hands.push({ landmarks, side, score });
  });

  return dedupeHands(hands);
}

function normalizeHandLandmarkGroups(results) {
  if (Array.isArray(results.multiHandLandmarks)) {
    return results.multiHandLandmarks;
  }

  if (Array.isArray(results.handLandmarks) && isLandmarkList(results.handLandmarks[0])) {
    return results.handLandmarks;
  }

  if (Array.isArray(results.landmarks) && isLandmarkList(results.landmarks[0])) {
    return results.landmarks;
  }

  if (isLandmarkList(results.landmarks)) {
    return [results.landmarks];
  }

  return [];
}

function resolveHandSide(hand, mirrored, usedSides) {
  if (hand.side && !usedSides.has(hand.side)) {
    return hand.side;
  }

  const wrist = hand.landmarks?.[0];

  if (wrist && Number.isFinite(wrist.x)) {
    const x = mirrored ? 1 - wrist.x : wrist.x;
    const inferred = x < 0.5 ? 'Left' : 'Right';

    if (!usedSides.has(inferred)) {
      return inferred;
    }
  }

  return ['Left', 'Right'].find((side) => !usedSides.has(side)) ?? null;
}

function dedupeHands(hands) {
  const bySide = new Map();
  const unknown = [];

  for (const hand of hands) {
    if (!hand?.landmarks?.length) {
      continue;
    }

    if (!hand.side) {
      unknown.push(hand);
      continue;
    }

    const current = bySide.get(hand.side);

    if (!current || hand.score > current.score) {
      bySide.set(hand.side, hand);
    }
  }

  return [...bySide.values(), ...unknown].slice(0, 2);
}

function readHandLabel(entry) {
  if (!entry) {
    return null;
  }

  if (Array.isArray(entry)) {
    return readHandLabel(entry[0]);
  }

  const candidate = entry.categoryName
    ?? entry.displayName
    ?? entry.label
    ?? entry.classification?.[0]?.label
    ?? entry.classifications?.[0]?.label
    ?? null;

  return typeof candidate === 'string' ? candidate : null;
}

function readHandScore(entry) {
  if (!entry) {
    return 0;
  }

  if (Array.isArray(entry)) {
    return readHandScore(entry[0]);
  }

  return Number(entry.score ?? entry.probability ?? entry.classification?.[0]?.score ?? 0) || 0;
}

function normalizeHandLabel(label, mirrored) {
  if (!label) {
    return null;
  }

  const lower = label.toLowerCase();
  const side = lower.includes('left') ? 'Left' : lower.includes('right') ? 'Right' : null;

  if (!side) {
    return null;
  }

  return mirrored ? side : oppositeSide(side);
}

function oppositeSide(side) {
  return side === 'Left' ? 'Right' : 'Left';
}

function createWorldDepthContext(landmarks, worldLandmarks) {
  if (!isLandmarkList(worldLandmarks)) {
    return null;
  }

  const screenShoulderMid = midpoint(
    screenVector(landmarks?.[POSE.leftShoulder]),
    screenVector(landmarks?.[POSE.rightShoulder]),
  );
  const screenHipMid = midpoint(
    screenVector(landmarks?.[POSE.leftHip]),
    screenVector(landmarks?.[POSE.rightHip]),
  );
  const worldShoulderMid = midpoint(
    worldVector(worldLandmarks?.[POSE.leftShoulder]),
    worldVector(worldLandmarks?.[POSE.rightShoulder]),
  );
  const worldHipMid = midpoint(
    worldVector(worldLandmarks?.[POSE.leftHip]),
    worldVector(worldLandmarks?.[POSE.rightHip]),
  );

  if (!screenShoulderMid || !screenHipMid || !worldShoulderMid || !worldHipMid) {
    return null;
  }

  const screenTorsoLength = screenShoulderMid.distanceTo(screenHipMid);
  const worldTorsoLength = worldShoulderMid.distanceTo(worldHipMid);

  if (screenTorsoLength < 0.0001 || worldTorsoLength < 0.0001) {
    return null;
  }

  return {
    centerZ: worldHipMid.z,
    worldToScreenScale: screenTorsoLength / worldTorsoLength,
  };
}

function screenVector(landmark) {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  return new THREE.Vector3((landmark.x - 0.5) * 2, (0.5 - landmark.y) * 2, 0);
}

function worldVector(landmark) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    !Number.isFinite(landmark.z)
  ) {
    return null;
  }

  return new THREE.Vector3(landmark.x, landmark.y, landmark.z);
}

function posePoint(landmarks, index, mirrored, minVisibility = 0.2, depthOptions = {}) {
  const landmark = landmarks?.[index];

  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  if (Number.isFinite(landmark.visibility) && landmark.visibility < minVisibility) {
    return null;
  }

  return landmarkToVector(landmark, mirrored, index, depthOptions);
}

function landmarkToVector(landmark, mirrored, index = -1, depthOptions = {}) {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  const x = ((mirrored ? 1 - landmark.x : landmark.x) - 0.5) * 2;
  const y = (0.5 - landmark.y) * 2;
  const z = -resolveLandmarkDepth(landmark, index, depthOptions);

  return new THREE.Vector3(x, y, z);
}

function resolveLandmarkDepth(landmark, index, depthOptions) {
  const depthScale = normalizeDepthScale(depthOptions.depthScale ?? DEFAULT_LANDMARK_DEPTH_SCALE);

  if (depthScale === 0) {
    return 0;
  }

  const worldLandmark = depthOptions.worldLandmarks?.[index];
  const worldContext = depthOptions.worldContext
    ?? createWorldDepthContext(depthOptions.landmarks, depthOptions.worldLandmarks);

  if (
    worldContext &&
    worldLandmark &&
    Number.isFinite(worldLandmark.z)
  ) {
    return (worldLandmark.z - worldContext.centerZ) * worldContext.worldToScreenScale * depthScale;
  }

  return (Number.isFinite(landmark.z) ? landmark.z : 0) * depthScale;
}

function midpoint(a, b) {
  if (!a || !b) {
    return null;
  }

  return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
}

function midpoint2D(a, b) {
  if (!a || !b) {
    return null;
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function normalizePose2D(points) {
  const center = midpoint2D(points.shoulderMid, points.hipMid) ?? points.hipMid ?? points.shoulderMid;
  const torsoScale = points.shoulderMid && points.hipMid
    ? distance2D(points.shoulderMid, points.hipMid)
    : 0;
  const shoulderScale = points.leftShoulder && points.rightShoulder
    ? distance2D(points.leftShoulder, points.rightShoulder)
    : 0;
  const hipScale = points.leftHip && points.rightHip
    ? distance2D(points.leftHip, points.rightHip)
    : 0;
  const scale = Math.max(torsoScale, shoulderScale, hipScale, 0.0001);
  const normalizedPoints = {};

  for (const [name, point] of Object.entries(points)) {
    if (!point || !center) {
      continue;
    }

    normalizedPoints[name] = {
      x: (point.x - center.x) / scale,
      y: (point.y - center.y) / scale,
    };
  }

  return {
    points: normalizedPoints,
    center,
    scale,
  };
}

function summarizeVisualJoints(joints) {
  const errors = joints
    .map((joint) => joint.error)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return {
    count: errors.length,
    meanError: mean(errors),
    medianError: percentile(errors, 0.5),
    p90Error: percentile(errors, 0.9),
    maxError: errors.length > 0 ? errors[errors.length - 1] : 0,
  };
}

function summarizeDepthValidationSegments(segments) {
  const all = summarizeDepthRows(segments);
  const depthSalient = summarizeDepthRows(segments.filter((segment) => segment.depthSalient));

  return {
    depthSource: 'mediapipe_relative_depth',
    matchThresholdDeg: DEPTH_MATCH_THRESHOLD_DEG,
    salientZRatio: DEPTH_SALIENT_Z_RATIO,
    all,
    depthSalient,
  };
}

function summarizeDepthRows(rows) {
  const errors = rows
    .map((segment) => segment.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const matchedCount = rows.filter((segment) => segment.matched).length;

  return {
    count: rows.length,
    matchedCount,
    matchRate: rows.length > 0 ? matchedCount / rows.length : 0,
    meanErrorDeg: mean(errors),
    medianErrorDeg: percentile(errors, 0.5),
    p90ErrorDeg: percentile(errors, 0.9),
    maxErrorDeg: errors.length > 0 ? errors[errors.length - 1] : 0,
  };
}

function distance2D(a, b) {
  if (!a || !b) {
    return 0;
  }

  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToArray(point) {
  return [point.x, point.y];
}

function summarizeValidationSegments(segments) {
  const errors = segments
    .map((segment) => segment.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const groups = {};

  for (const segment of segments) {
    if (!Number.isFinite(segment.errorDeg)) {
      continue;
    }

    const group = groups[segment.group] ?? {
      count: 0,
      meanErrorDeg: 0,
      maxErrorDeg: 0,
    };
    group.count += 1;
    group.meanErrorDeg += segment.errorDeg;
    group.maxErrorDeg = Math.max(group.maxErrorDeg, segment.errorDeg);
    groups[segment.group] = group;
  }

  for (const group of Object.values(groups)) {
    if (group.count > 0) {
      group.meanErrorDeg /= group.count;
    }
  }

  const worstSegment = segments.reduce((worst, segment) => {
    if (!Number.isFinite(segment.errorDeg)) {
      return worst;
    }

    if (!worst || segment.errorDeg > worst.errorDeg) {
      return {
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
      };
    }

    return worst;
  }, null);

  return {
    count: errors.length,
    meanErrorDeg: mean(errors),
    medianErrorDeg: percentile(errors, 0.5),
    p90ErrorDeg: percentile(errors, 0.9),
    maxErrorDeg: errors.length > 0 ? errors[errors.length - 1] : 0,
    groups,
    worstSegment,
  };
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1),
  );
  return sortedValues[index];
}

function vectorToArray(vector) {
  return [vector.x, vector.y, vector.z];
}

function inferBoneAxisLocal(bone) {
  const childBone = bone.children.find((child) => child.isBone);

  if (childBone && childBone.position.lengthSq() > 0.000001) {
    return childBone.position.clone().normalize();
  }

  if (bone.position.lengthSq() > 0.000001) {
    return bone.position.clone().normalize();
  }

  if (bone.name.includes('Arm') || bone.name.includes('Hand') || bone.name.includes('Finger')) {
    return bone.name.includes('Right') ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
  }

  return new THREE.Vector3(0, 1, 0);
}

function inferSecondaryAxisLocal(axisLocal) {
  const secondary = new THREE.Vector3();
  choosePerpendicularAxis(axisLocal, secondary);
  return secondary;
}

function choosePerpendicularAxis(primary, target) {
  const fallback = Math.abs(primary.y) < 0.82
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  target.copy(fallback).addScaledVector(primary, -fallback.dot(primary));

  if (target.lengthSq() < 0.000001) {
    target.set(1, 0, 0).addScaledVector(primary, -primary.x);
  }

  return target.normalize();
}

function disposeModelResources(root) {
  if (!root) {
    return;
  }

  root.traverse((object) => {
    if (object.isMesh) {
      object.geometry?.dispose?.();
      disposeMaterial(object.material);
    }
  });
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }

  if (!material) {
    return;
  }

  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      value.dispose();
    }
  }

  material.dispose?.();
}

function isLandmarkList(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0]?.x)
    && Number.isFinite(value[0]?.y);
}

function isMixamoBoneName(name) {
  return typeof name === 'string'
    && (name.startsWith(BONE_PREFIX) || name.startsWith(sanitizeBoneName(BONE_PREFIX)));
}

function boneNameAliases(name) {
  const aliases = new Set([name]);
  const sanitized = sanitizeBoneName(name);
  const unsanitized = unsanitizeBoneName(name);

  if (sanitized) {
    aliases.add(sanitized);
  }

  if (unsanitized) {
    aliases.add(unsanitized);
  }

  return [...aliases];
}

function boneName(name) {
  if (name.startsWith(BONE_PREFIX)) {
    return name;
  }

  if (name.startsWith(sanitizeBoneName(BONE_PREFIX))) {
    return name;
  }

  return `${BONE_PREFIX}${name}`;
}

function sanitizeBoneName(name) {
  return typeof name === 'string' ? name.replaceAll(':', '') : '';
}

function unsanitizeBoneName(name) {
  const sanitizedPrefix = sanitizeBoneName(BONE_PREFIX);

  if (typeof name !== 'string' || !name.startsWith(sanitizedPrefix)) {
    return name;
  }

  return `${BONE_PREFIX}${name.slice(sanitizedPrefix.length)}`;
}

function ensureCanvas(value) {
  if (!value || typeof value.getContext !== 'function') {
    throw new Error('avatar canvas missing');
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value || 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDepthScale(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_LANDMARK_DEPTH_SCALE;
  }

  return clamp(number, 0, 1.5);
}
