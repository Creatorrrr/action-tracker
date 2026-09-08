#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as core from './tools/sam-goal-manual-review-viewer-v1/core.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CDP = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-chrome-cdp-v1.mjs');
let cdpImportUrl = pathToFileURL(CDP).href;
if (process.env.SAM_FOCUS_CHROME_BINARY) {
  const chromeBinary = path.resolve(process.env.SAM_FOCUS_CHROME_BINARY);
  assert.equal(path.isAbsolute(chromeBinary), true, 'SAM_FOCUS_CHROME_BINARY must resolve to an absolute path');
  assert.equal(existsSync(chromeBinary), true, `SAM_FOCUS_CHROME_BINARY is missing: ${chromeBinary}`);
  const chromeNeedle = "export const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';";
  const cdpSource = readFileSync(CDP, 'utf8');
  assert.equal(cdpSource.split(chromeNeedle).length - 1, 1, 'CDP Chrome binary pin must occur exactly once');
  const focusedCdpSource = cdpSource.replace(
    chromeNeedle,
    `export const CHROME_BINARY = ${JSON.stringify(chromeBinary)};`,
  );
  cdpImportUrl = `data:text/javascript;base64,${Buffer.from(focusedCdpSource).toString('base64')}`;
}

const {
  EXPECTED_CHROME_PRODUCT,
  closePage,
  createPage,
  evaluate,
  navigate,
  setViewport,
  startHeadedChrome,
  stopHeadedChrome,
} = await import(cdpImportUrl);

const NODE = '/Users/chasoik/.nvm/versions/node/v22.17.0/bin/node';
const CLI = path.join(ROOT, 'scripts/sam-goal-manual-review-ops-v1.mjs');
const GATE = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-presentation-gate-v1.mjs');
const MAIN_TEST = path.join(ROOT, 'tests/sam-goal-manual-review-ops-v1-check.mjs');
const OWNED_MANIFEST = '/private/tmp/mro-r3-owned-paths-final1.txt';
const EXPECTED = Object.freeze({
  gateSha256: '6572a3ced921afbe2e1635537d9f85abd13b30ed993a494aa420dabcda6babd7',
  mainSha256: '93cee70b03bcf5d6d872a02c77405eb025e8a2572ea5260853f118b84f6df30b',
  ownedAggregateSha256: '8b1a8f4181dafd4f3a20059990b514816f35ff2ed3b01b2e7a45d4bcce8d0a8d',
});
const EXPECTED_REAL_CASES = Object.freeze([
  Object.freeze({ viewport: Object.freeze({ width: 1280, height: 720, deviceScaleFactor: 1 }), targetedDsf2: false }),
  Object.freeze({ viewport: Object.freeze({ width: 1440, height: 1000, deviceScaleFactor: 1 }), targetedDsf2: false }),
  Object.freeze({ viewport: Object.freeze({ width: 1280, height: 720, deviceScaleFactor: 2 }), targetedDsf2: true }),
  Object.freeze({ viewport: Object.freeze({ width: 1440, height: 1000, deviceScaleFactor: 2 }), targetedDsf2: true }),
]);
const RUNTIME_ENV = Object.freeze({
  ...process.env,
  NODE_ENV: 'test',
  SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function rasterRegionIntersectionArea(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function ownedFreeze() {
  const files = readFileSync(OWNED_MANIFEST, 'utf8').split(/\r?\n/u).filter(Boolean);
  assert.equal(files.length, 30);
  const shasumStream = files.map((file) => `${sha256(readFileSync(path.join(ROOT, file)))}  ${file}\n`).join('');
  return {
    gateSha256: sha256(readFileSync(GATE)),
    mainSha256: sha256(readFileSync(MAIN_TEST)),
    ownedAggregateSha256: sha256(Buffer.from(shasumStream)),
    ownedFileCount: files.length,
  };
}

function assertExactFreeze(label) {
  const actual = ownedFreeze();
  assert.deepEqual(actual, { ...EXPECTED, ownedFileCount: 30 }, `${label}: exact freeze drift`);
  return actual;
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  assert.notEqual(first, -1, `${label}: source needle missing`);
  assert.equal(source.indexOf(needle, first + needle.length), -1, `${label}: source needle duplicated`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

async function importFocusedGate({ label }) {
  let source = readFileSync(GATE, 'utf8');
  source = replaceOnce(
    source,
    "from './headed-chrome-cdp-v1.mjs';",
    `from ${JSON.stringify(cdpImportUrl)};`,
    `${label}: CDP import`,
  );
  for (const [kind, name] of [
    ['async function', 'waitFor'],
    ['function', 'modeSurface'],
    ['async function', 'presentationSnapshot'],
    ['function', 'assertFitGeometry'],
    ['async function', 'currentCaptureState'],
    ['async function', 'waitForInitialExactStill'],
    ['async function', 'prepareTargetViewport'],
    ['async function', 'captureInitialAutoLockEvidence'],
    ['async function', 'runAncestorCompositorGuardOracle'],
    ['async function', 'runPseudoCompositorGuardOracle'],
    ['async function', 'runCompositorFailureOracles'],
    ['async function', 'runPresentationNonceDomMutationOracles'],
    ['async function', 'runRealSources'],
    ['async function', 'runSyntheticSources'],
    ['async function', 'runNegativeControls'],
    ['async function', 'runTransitionStress'],
  ]) {
    source = replaceOnce(source, `${kind} ${name}(`, `export ${kind} ${name}(`, `${label}: export ${name}`);
  }
  if (process.env.SAM_FOCUS_DIAG_EXACT_ANCESTOR === '1') {
    source = replaceOnce(
      source,
      "if(!ancestor||!state)throw new Error('presentation_ancestor_oracle_restoration_missing');if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);globalThis.__samGoalPresentationCaptureEpoch=(globalThis.__samGoalPresentationCaptureEpoch??0)+1;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{styleState:",
      "if(!ancestor||!state)throw new Error('presentation_ancestor_oracle_restoration_missing');const restorationTrace=[],recordRestoration=(label)=>restorationTrace.push({label,hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText:ancestor.style.cssText,computedFilter:getComputedStyle(ancestor).filter});recordRestoration('after-svg-remove-before-raw-restore');if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);recordRestoration('after-raw-restore');globalThis.__samGoalPresentationCaptureEpoch=(globalThis.__samGoalPresentationCaptureEpoch??0)+1;recordRestoration('after-epoch');await new Promise(requestAnimationFrame);recordRestoration('after-raf-1');await new Promise(requestAnimationFrame);recordRestoration('after-raf-2');return{restorationTrace,styleState:",
      `${label}: exact ancestor trace body`,
    );
    source = replaceOnce(
      source,
      'assert.deepEqual(restoration.styleState, applied.styleState);',
      'void restoration.styleState;',
      `${label}: exact ancestor trace assertion bypass`,
    );
    source = replaceOnce(
      source,
      "return { mutation: 'ancestor-palette-preserving-component-transfer-filter',",
      "return { restorationTrace: restoration.restorationTrace, appliedRawStyleState: applied.styleState, restoredRawStyleState: restoration.styleState, mutation: 'ancestor-palette-preserving-component-transfer-filter',",
      `${label}: exact ancestor trace return`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_BYPASS_ANCESTOR === '1') {
    source = replaceOnce(
      source,
      'assert.deepEqual(restoration.styleState, applied.styleState);',
      'void restoration.styleState;',
      `${label}: bypass ancestor style assertion`,
    );
    source = replaceOnce(
      source,
      "return { mutation: 'ancestor-palette-preserving-component-transfer-filter',",
      "return { appliedRawStyleState: applied.styleState, restoredRawStyleState: restoration.styleState, mutation: 'ancestor-palette-preserving-component-transfer-filter',",
      `${label}: bypass ancestor trace return`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_FLUSH_ANCESTOR === '1') {
    source = replaceOnce(
      source,
      "if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);globalThis.__samGoalPresentationCaptureEpoch=",
      "if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);const restoredComputedFilter=getComputedStyle(ancestor).filter;if(restoredComputedFilter!=='none')throw new Error('presentation_ancestor_oracle_restoration_filter_not_none');globalThis.__samGoalPresentationCaptureEpoch=",
      `${label}: ancestor computed flush probe`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_FINAL_RESTORE_ANCESTOR === '1') {
    source = replaceOnce(
      source,
      "globalThis.__samGoalPresentationCaptureEpoch=(globalThis.__samGoalPresentationCaptureEpoch??0)+1;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{styleState:{hasAttribute:ancestor.hasAttribute('style')",
      "globalThis.__samGoalPresentationCaptureEpoch=(globalThis.__samGoalPresentationCaptureEpoch??0)+1;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const settledCssText=ancestor.style.cssText;if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);return{styleState:{hasAttribute:ancestor.hasAttribute('style')",
      `${label}: ancestor post-settle exact raw restore probe`,
    );
    source = replaceOnce(
      source,
      "cssText:ancestor.style.cssText},oracleSvgCount:document.querySelectorAll('[data-sam-goal-ancestor-filter-oracle]')",
      "cssText:settledCssText},oracleSvgCount:document.querySelectorAll('[data-sam-goal-ancestor-filter-oracle]')",
      `${label}: ancestor post-settle cssom-before-raw probe`,
    );
    source = replaceOnce(
      source,
      'assert.deepEqual(restoration.styleState, applied.styleState);',
      'void restoration.styleState;',
      `${label}: ancestor post-settle assertion probe`,
    );
    source = replaceOnce(
      source,
      "return { mutation: 'ancestor-palette-preserving-component-transfer-filter',",
      "return { appliedRawStyleState: applied.styleState, restoredRawStyleState: restoration.styleState, mutation: 'ancestor-palette-preserving-component-transfer-filter',",
      `${label}: ancestor post-settle return probe`,
    );
    source = replaceOnce(
      source,
      "assert.equal(restoredState.selectorIdentity.formalTargetNodeIdentity, baselineState.selectorIdentity.formalTargetNodeIdentity); return { appliedRawStyleState:",
      "assert.equal(restoredState.selectorIdentity.formalTargetNodeIdentity, baselineState.selectorIdentity.formalTargetNodeIdentity);const finalRawRestoration=await evaluate(page, `(async()=>{const ancestor=document.getElementById(${JSON.stringify(surface.targetId)})?.parentElement?.parentElement,state=${JSON.stringify(applied.styleState)};if(!ancestor)throw new Error('presentation_ancestor_oracle_final_raw_target_missing');const settledCssText=ancestor.style.cssText;if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);return{hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText:settledCssText};})()`);assert.deepEqual(finalRawRestoration,applied.styleState);const finalRawVerification=await evaluate(page, `(()=>{const ancestor=document.getElementById(${JSON.stringify(surface.targetId)})?.parentElement?.parentElement;if(!ancestor)throw new Error('presentation_ancestor_oracle_final_raw_target_missing');const cssText=ancestor.style.cssText;return{hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText};})()`);assert.deepEqual(finalRawVerification,applied.styleState);return { finalRawRestoration, finalRawVerification, appliedRawStyleState:",
      `${label}: ancestor post-computed final raw probe`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_QUANTIZED_NONCE === '1') {
    source = replaceOnce(
      source,
      "const rect=formal.getBoundingClientRect(),nonce=document.createElement('div');",
      "const rect=formal.getBoundingClientRect(),physicalWidth=rect.width*devicePixelRatio,physicalBoundaries=Array.from({length:65},(_,index)=>index===64?physicalWidth:Math.round(physicalWidth*index/64)),columnDeviceWidths=physicalBoundaries.slice(1).map((boundary,index)=>boundary-physicalBoundaries[index]);if(columnDeviceWidths.some((width)=>!(width>0)))throw new Error('presentation_background_nonce_quantized_column_invalid');const gridTemplateColumns=columnDeviceWidths.map((width)=>width/devicePixelRatio+'px').join(' '),nonce=document.createElement('div');",
      `${label}: DPR-quantized nonce columns`,
    );
    source = replaceOnce(
      source,
      'grid-template-columns:repeat(${PRESENTATION_NONCE_STRIPE_COUNT},minmax(0,1fr));grid-template-rows:1fr',
      "grid-template-columns:'+gridTemplateColumns+';grid-template-rows:1fr",
      `${label}: DPR-quantized nonce grid template`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_PIXEL_FOOTPRINT_NONCE === '1') {
    source = replaceOnce(
      source,
      'candidate <= PRESENTATION_NONCE_BOUNDARY_EXCLUSION_DEVICE_PX && candidate < distance',
      'candidate < PRESENTATION_NONCE_BOUNDARY_EXCLUSION_DEVICE_PX + 0.5 && candidate < distance',
      `${label}: pixel-footprint nonce boundary probe`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_OUTER_FOOTPRINT_NONCE === '1') {
    source = replaceOnce(
      source,
      'return selected; };\n  let checkedPixels',
      "return selected; }; const outerBoundaryAt=(x,y)=>{const centerX=x+0.5,centerY=y+0.5,left=nonceLayout.nonceRect.left*dpr,right=nonceLayout.nonceRect.right*dpr,top=nonceLayout.nonceRect.top*dpr,bottom=nonceLayout.nonceRect.bottom*dpr;return Math.min(Math.abs(centerX-left),Math.abs(centerX-right),Math.abs(centerY-top),Math.abs(centerY-bottom))<PRESENTATION_NONCE_BOUNDARY_EXCLUSION_DEVICE_PX+0.5;};\n  let checkedPixels",
      `${label}: outer pixel-footprint nonce boundary probe`,
    );
    source = replaceOnce(
      source,
      'checkedPixels += 1; const boundary = boundaryAt(x);',
      "checkedPixels += 1; const outerStripe=stripeAt(x);if(outerBoundaryAt(x,y)){boundaryPixels+=1;if(outerStripe<0){mismatchPixels+=1;unmappedPixels+=1;continue;}const outerInternalBoundary=boundaryAt(x),allowedOuter=[expectedRgb(outerStripe),PRESENTATION_NONCE_RAW_SCREENSHOT_RGB.bit1,...(outerInternalBoundary>=0?[expectedRgb(outerInternalBoundary),expectedRgb(outerInternalBoundary+1)]:[])];if(!allowedOuter.some((rgb)=>exactRgb(x,y,rgb)))mismatchPixels+=1;continue;} const boundary = boundaryAt(x);",
      `${label}: outer pixel-footprint nonce loop probe`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_NONCE_LAYOUT_DETAILS === '1') {
    source = replaceOnce(
      source,
      "details: { nonceToken, patternSha256: pattern.patternSha256, layoutSha256, bbox, interior",
      "details: { geometry, nonceLayout, nonceToken, patternSha256: pattern.patternSha256, layoutSha256, bbox, interior",
      `${label}: nonce layout failure details probe`,
    );
  }
  if (process.env.SAM_FOCUS_DIAG_BYPASS_NEGATIVE_OUTER_STYLE === '1') {
    source = replaceOnce(
      source,
      "assert.deepEqual(await negativeDomState(page, surface), originalState, `${mode}@${deviceScaleFactor}: negative outer DOM state restoration drift`);",
      "void await negativeDomState(page, surface);",
      `${label}: reveal primary negative-control failure`,
    );
  }
  source += `\n//# sourceURL=${label}.mjs\n`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function log(stage, details = {}) {
  process.stdout.write(`${JSON.stringify({ status: 'focus_progress', stage, ...details })}\n`);
}

function parseJsonLines(chunks) {
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processGroupGone(child) {
  try {
    process.kill(-child.pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}

async function waitForGroupGone(child, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processGroupGone(child)) return true;
    await delay(25);
  }
  return processGroupGone(child);
}

async function startServe(bundle) {
  const child = spawn(NODE, [CLI, 'serve', '--bundle-dir', bundle], {
    cwd: ROOT,
    env: RUNTIME_ENV,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let pending = '';
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const exitPromise = new Promise((resolve) => child.once('exit', (status, signal) => resolve({ status, signal })));
  const timer = setTimeout(() => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error('serve_ready_timeout'));
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    }
  }, 45_000);
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => {
    stderr.push(Buffer.from(chunk));
    pending += chunk.toString('utf8');
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const value = JSON.parse(line);
        if (!readySettled && value.status === 'review_ui_ready' && value.host === '127.0.0.1' && Number.isInteger(value.port)) {
          assert.equal(Buffer.concat(stdout).length, 0, 'serve stdout leaked before readiness');
          readySettled = true;
          clearTimeout(timer);
          resolveReady(value);
        }
      } catch {}
    }
  });
  exitPromise.then(({ status, signal }) => {
    if (!readySettled) {
      readySettled = true;
      clearTimeout(timer);
      rejectReady(new Error(`serve_exited_before_ready:${status}:${signal}:${Buffer.concat(stderr).toString('utf8')}`));
    }
  });
  const ready = await readyPromise;
  return {
    child,
    ready,
    base: `http://127.0.0.1:${ready.port}`,
    stdout,
    stderr,
    exitPromise,
  };
}

async function stopServe(server, { strict = true } = {}) {
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGTERM');
  let exit = await Promise.race([server.exitPromise, delay(5_000).then(() => null)]);
  if (exit === null) {
    try { process.kill(-server.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    exit = await Promise.race([server.exitPromise, delay(5_000).then(() => null)]);
  }
  assert.ok(exit, 'serve process did not exit');
  if (!await waitForGroupGone(server.child)) {
    try { process.kill(-server.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    assert.equal(await waitForGroupGone(server.child), true, 'serve descendant survived cleanup');
  }
  const stdout = Buffer.concat(server.stdout).toString('utf8');
  const stderr = Buffer.concat(server.stderr).toString('utf8');
  if (strict) {
    assert.deepEqual({ status: exit.status, signal: exit.signal }, { status: 143, signal: null }, `serve TERM exit: ${stderr}`);
    assert.equal(parseJsonLines(server.stdout).some((item) => item.status === 'review_session_sealed'), false);
    let refused = false;
    try { await fetch(`${server.base}/api/manifest`, { signal: AbortSignal.timeout(1_000) }); } catch { refused = true; }
    assert.equal(refused, true, 'serve endpoint survived TERM');
  }
  return { ...exit, stdout, stderr };
}

function prepareBundle(bundle, cycleId) {
  const result = spawnSync(NODE, [
    CLI,
    'prepare-bundle',
    '--mode', 'first',
    '--actor-pseudonym-sha256', 'a'.repeat(64),
    '--cycle-id', cycleId,
    '--bundle-dir', bundle,
  ], {
    cwd: ROOT,
    env: RUNTIME_ENV,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  assert.equal(result.error, undefined, result.error?.stack);
  assert.equal(result.status, 0, `prepare-bundle failed: ${result.stderr}`);
  return result.stdout.trim();
}

function attemptResidue(root) {
  if (!existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.includes('.capture-attempt-') || /\.(?:next|seal)-[1-9]/u.test(entry.name)) result.push(path.relative(root, full));
    }
  };
  visit(root);
  return result.sort();
}

function rasterRegionSubset(inner, outer) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function expectedNonceDomain(nonce) {
  const { formalTargetRect: nonceRect, dpr } = nonce.actualLayout;
  const left = Math.ceil(nonceRect.left) * dpr;
  const right = Math.ceil(nonceRect.right) * dpr;
  const top = Math.floor(nonceRect.top) * dpr;
  const bottom = Math.ceil(nonceRect.bottom) * dpr;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function assertFocusedNonceCapture(record, lifecycleClass) {
  const freshness = record.outputFreshness;
  assert.equal(freshness.authorityVersion, 'all-four-plane-destinations-absent-at-capture-start-v1');
  assert.equal(freshness.existingCount, 0);
  assert.equal(freshness.noPreclean, true);
  assert.deepEqual(freshness.planeNames, ['background', 'solid', 'reference', 'target']);
  assert.equal(freshness.outputPaths.length, 4);
  assert.equal(new Set(freshness.outputPaths).size, 4);
  assert.equal(freshness.allPlaneDimensionsExact, true);
  assert.deepEqual(freshness.completedDimensions, {
    background: freshness.expectedDimensions,
    solid: freshness.expectedDimensions,
    reference: freshness.expectedDimensions,
    target: freshness.expectedDimensions,
  });
  assert.ok(freshness.outputPaths.every((outputPath) => existsSync(outputPath)));

  const nonce = record.backgroundNonce;
  assert.equal(nonce.authorityVersion, 'viewport-device-raster-nonce-v1');
  assert.equal(nonce.scanDomainName, 'G');
  assert.equal(nonce.scanDomainPolicy, 'every-G-pixel-byte-exact-threshold-0-v1');
  assert.equal(nonce.supportedDpr, true);
  assert.equal(nonce.scanDomainCoordinatesSafeIntegers, true);
  assert.equal(nonce.scanDomainPositive, true);
  assert.equal(nonce.scanDomainInScreenshot, true);
  assert.equal(nonce.scanDomainSubsetE, true);
  assert.equal(nonce.eSubsetG, true);
  assert.equal(nonce.physicalDIsNonceAuthority, false);
  assert.deepEqual(nonce.P, expectedNonceDomain(nonce));
  assert.deepEqual(nonce.G, nonce.physicalDomains.G);
  assert.equal(rasterRegionSubset(nonce.P, nonce.physicalDomains.E), true);
  assert.equal(rasterRegionSubset(nonce.physicalDomains.E, nonce.physicalDomains.G), true);
  assert.deepEqual(nonce.actualLayout.hostRect, nonce.formalTargetRect);
  assert.deepEqual(nonce.canvasCssRect, nonce.actualLayout.viewportCssRect);
  assert.deepEqual(nonce.canvasBackingStore, nonce.actualLayout.screenshotDimensions);
  assert.deepEqual(nonce.actualLayout.structure, { hostIsStageChild: true, hostChildCount: 1, canvasCount: 1, paintedDomStripeCount: 0 });
  assert.equal(nonce.paintedDomStripeCount, 0);
  assert.equal(nonce.formalZIndex, '1');
  assert.equal(nonce.hostZIndex, '0');
  assert.equal(nonce.canvasZIndex, '0');
  assert.equal(nonce.fixedContainingBlockViewportExact, true);
  assert.equal(nonce.patternVersion, 'fixed-10-sha61-fixed-1-v2');
  assert.equal(nonce.tokenBitCount, 61);
  assert.equal(nonce.fixedStripes.first, 1);
  assert.equal(nonce.fixedStripes.second, 0);
  assert.equal(nonce.fixedStripes.last, 1);
  assert.equal(nonce.boundaries.length, 65);
  assert.deepEqual(nonce.boundaries, Array.from({ length: 65 }, (_, index) => nonce.P.x + Math.floor(index * nonce.P.width / 64)));
  assert.equal(nonce.boundariesStrict, true);
  assert.equal(nonce.PRowBitsExact, true);
  assert.equal(nonce.PRowEdgesExact, true);
  assert.equal(nonce.PRowCount, nonce.P.height);
  assert.equal(nonce.expectedTransitionCount, nonce.observedTransitionCount);
  assert.equal(nonce.gOutsidePExact, true);
  assert.equal(nonce.gOutsidePMismatchPixels, 0);
  assert.equal(nonce.consumedPixels, nonce.domainPixels);
  assert.equal(nonce.allPixelsConsumed, true);
  assert.equal(nonce.expectedRasterRgbaSha256, nonce.canvasReadbackRgbaSha256);
  assert.equal(nonce.expectedRasterRgbSha256, nonce.screenshotRasterRgbSha256);
  assert.equal(nonce.rasterSha256, nonce.screenshotRasterRgbSha256);
  assert.equal(nonce.layoutBindingVersion, 'viewport-device-raster-layout-binding-v1');
  assert.equal(nonce.layoutBindingSha256, nonce.actualLayout.layoutBindingSha256);
  assert.equal(nonce.mismatchThreshold, 0);
  assert.equal(nonce.mismatchPixels, 0);
  assert.equal(nonce.coverage, 1);

  const challenge = nonce.challenge;
  assert.equal(challenge.authorityVersion, 'node-csprng-capture-challenge-v1');
  assert.equal(challenge.entropyBytes, 32);
  assert.equal(challenge.rawChallengeDisclosed, false);
  assert.equal(Object.hasOwn(challenge, 'challenge'), false);
  assert.match(challenge.challengeSha256, /^[0-9a-f]{64}$/u);
  assert.match(challenge.bindingKeySha256, /^[0-9a-f]{64}$/u);
  assert.equal(challenge.nonceToken, nonce.nonceToken);
  assert.equal(challenge.nonceTokenSha256, nonce.nonceTokenSha256);
  assert.equal(challenge.nonceTokenSha256, sha256(Buffer.from(challenge.nonceToken)));
  const release = nonce.releaseEvidence;
  assert.equal(release.authorityVersion, 'deterministic-canvas-backing-release-v1');
  assert.equal(release.lifecycleClass, lifecycleClass);
  assert.equal(release.hostCountBefore, 1);
  assert.equal(release.releasedCanvasCount, 1);
  assert.deepEqual(release.preBackingStore, nonce.canvasBackingStore);
  assert.deepEqual(release.expectedBackingStore, nonce.canvasBackingStore);
  assert.equal(release.preBackingStorePositive, true);
  assert.equal(release.preBackingStoreExactExpected, true);
  assert.deepEqual(release.postBackingStore, { width: 0, height: 0 });
  assert.equal(release.zeroedBeforeHostRemoval, true);
  assert.equal(release.hostRemoved, true);
  assert.equal(release.nonceTokenSha256, nonce.nonceTokenSha256);
  assert.equal(release.nonceNodeCountAfterRestore, 0);
  assert.equal(release.rawAttributeAndOwnedStateExact, true);
  assert.equal(release.historicalCssomDiagnosticOnly, true);
  assert.equal(release.readOnlySettleBarrierCount, 1);
  assert.equal(release.postFinalRawReplayCssomStable, true);
  assert.equal(release.formalRestorationTrace.authorityVersion, 'presentation-formal-a-barrier-b-stability-v1');
  assert.equal(release.formalRestorationTrace.exact, true);
  assert.deepEqual(release.formalRestorationTrace.canonicalA, release.formalRestorationTrace.canonicalB);
  assert.equal(release.formalRestorationTrace.barrier.authorityVersion, 'two-raf-bcr-computed-read-only-settle-v1');
  assert.equal(release.formalRestorationTrace.barrier.readOnly, true);
  assert.equal(release.formalRestorationTrace.barrier.rafCount, 2);
  assert.equal(release.stageBackgroundRestoration.exact, true);
  assert.deepEqual(release.stageBackgroundRestoration.actual, release.stageBackgroundRestoration.expected);
  assert.equal(release.postRestoreComputedAndGeometryVerifiedBeforeRepair, true);
  assert.equal(release.releases.length, 1);
  return { outputPaths: freshness.outputPaths, challengeSha256: challenge.challengeSha256, nonceToken: challenge.nonceToken };
}

async function diagnoseAncestorRestore(gate, page, surface) {
  const filterId = `sam-goal-ancestor-trace-${Date.now()}`;
  const applied = await evaluate(page, `(async()=>{const formal=document.getElementById(${JSON.stringify(surface.targetId)}),ancestor=formal?.parentElement?.parentElement,filterId=${JSON.stringify(filterId)},record=(label)=>({label,hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText:ancestor.style.cssText,computedFilter:getComputedStyle(ancestor).filter});if(!(formal instanceof HTMLCanvasElement)||!ancestor)throw new Error('trace_target_missing');const styleState={hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText:ancestor.style.cssText},namespace='http://www.w3.org/2000/svg',svg=document.createElementNS(namespace,'svg'),filter=document.createElementNS(namespace,'filter'),blur=document.createElementNS(namespace,'feGaussianBlur');svg.setAttribute('data-sam-goal-ancestor-trace',filterId);svg.setAttribute('aria-hidden','true');filter.id=filterId;blur.setAttribute('stdDeviation','0.01');filter.append(blur);svg.append(filter);document.body.append(svg);ancestor.style.filter='url("#'+filterId+'")';globalThis.__samGoalPresentationCaptureEpoch=(globalThis.__samGoalPresentationCaptureEpoch??0)+1;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{styleState,afterApplied:record('after-applied')};})()`);
  const mutatedSnapshot = await gate.presentationSnapshot(page, surface);
  let captureError = null;
  try { await gate.currentCaptureState(page, surface); } catch (error) { captureError = { code: error.code ?? null, message: error.message }; }
  const cleanup = await evaluate(page, `(async()=>{const formal=document.getElementById(${JSON.stringify(surface.targetId)}),ancestor=formal?.parentElement?.parentElement,state=${JSON.stringify(applied.styleState)},filterId=${JSON.stringify(filterId)},trace=[],record=(label,{computed=false}={})=>{const item={label,hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText:ancestor.style.cssText};if(computed)item.computedFilter=getComputedStyle(ancestor).filter;trace.push(item);};record('cleanup-entry',{computed:true});document.querySelectorAll('[data-sam-goal-ancestor-trace="'+filterId+'"]').forEach((node)=>node.remove());record('after-svg-remove',{computed:true});if(!state.hasAttribute)ancestor.removeAttribute('style');else ancestor.setAttribute('style',state.attribute);record('after-raw-restore',{computed:true});globalThis.__samGoalPresentationCaptureEpoch=(globalThis.__samGoalPresentationCaptureEpoch??0)+1;record('after-epoch',{computed:true});await new Promise(requestAnimationFrame);record('after-raf-1',{computed:true});await new Promise(requestAnimationFrame);record('after-raf-2',{computed:true});return{trace,finalStyleState:{hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null,cssText:ancestor.style.cssText}};})()`);
  const postSnapshot = await gate.presentationSnapshot(page, surface);
  return {
    baselineStyleState: applied.styleState,
    afterApplied: applied.afterApplied,
    mutatedFirstCode: mutatedSnapshot.ancestorChain.firstCode,
    captureError,
    cleanup,
    postSnapshotFirstCode: postSnapshot.ancestorChain.firstCode,
  };
}

async function main() {
  assert.equal(process.execPath, NODE, `focused harness must use trusted Node ${NODE}`);
  const initialFreeze = assertExactFreeze('pre-focus');
  const tempRoot = mkdtempSync('/private/tmp/sam-mro-r3-focus-');
  const bundle = path.join(tempRoot, 'bundle-first');
  const captureDir = path.join(tempRoot, 'captures');
  mkdirSync(captureDir, { recursive: true, mode: 0o700 });
  const cycleId = `mro-r3-focused-${Date.now()}`;
  let server = null;
  let browser = null;
  let page = null;
  let succeeded = false;
  try {
    log('freeze_verified', initialFreeze);
    const [gate, publicState] = await Promise.all([
      importFocusedGate({ label: 'mro-r3-focus-default' }),
      core.verifyPublicPins(),
    ]);
    assert.equal(gate.runPresentationMaskMicroTest().iterations, 10_000);
    log('gate_loaded_and_micro_passed');

    prepareBundle(bundle, cycleId);
    log('bundle_prepared', { bundle, cycleId });
    server = await startServe(bundle);
    log('serve_ready', { port: server.ready.port });

    browser = await startHeadedChrome({ windowWidth: 1440, windowHeight: 1000 });
    assert.equal(browser.product, EXPECTED_CHROME_PRODUCT);
    page = await createPage(browser);
    await setViewport(page, EXPECTED_REAL_CASES[0].viewport);
    await navigate(page, server.base, { timeoutMs: 30_000 });

    const mode = 'first';
    const surface = gate.modeSurface(mode);
    await gate.waitFor(
      page,
      `document.querySelectorAll('[data-sam-goal-evidence-target="${surface.target}"]').length===1&&document.getElementById(${JSON.stringify(surface.stageId)})&&document.getElementById('lock')&&document.getElementById('motion')`,
      'focused first viewer DOM mounted',
      45_000,
    );
    assert.equal(await evaluate(page, `(async()=>(${JSON.stringify(mode)}) === (await fetch('/api/manifest',{cache:'no-store'}).then(r=>r.json())).mode)()`), true);
    log('headed_dom_ready', { chromeProduct: browser.product });

    const sourceCases = gate.presentationSourceCases(publicState);
    const initialSource = sourceCases[0];
    const initialSpot = initialSource.spots[0];
    const passiveReadiness = await gate.waitForInitialExactStill(page, surface, initialSource, initialSpot);
    const initialSnapshot = await gate.presentationSnapshot(page, surface);
    assert.deepEqual({ width: initialSnapshot.width, height: initialSnapshot.height }, { width: initialSource.width, height: initialSource.height });
    gate.assertFitGeometry(initialSnapshot);
    const viewportPreparation = await gate.prepareTargetViewport(page, surface);
    const initial = await gate.captureInitialAutoLockEvidence(page, surface, mode, initialSource, initialSpot, captureDir, passiveReadiness, viewportPreparation);
    assert.equal(initial.visiblePlane.stablePlaneCount, 1);
    log('initial_auto_lock_passed', { directExactStillSsim: initial.intrinsic.directExactStillSsim });

    if (process.env.SAM_FOCUS_DIAG_STYLE_FIRST_TOUCH === '1') {
      const trace = await evaluate(page, `(async()=>{const formal=document.getElementById(${JSON.stringify(surface.targetId)}),ancestor=formal?.parentElement?.parentElement;if(!(formal instanceof HTMLCanvasElement)||!ancestor)throw new Error('first_style_touch_probe_target_missing');const raw=(node)=>({hasAttribute:node.hasAttribute('style'),attribute:node.hasAttribute('style')?node.getAttribute('style'):null});const definitions=[['ephemeral-current',async(node)=>{node.style.cssText='';const cleared=node.style.cssText;node.removeAttribute('style');return{cleared};}],['stable-ref',async(node)=>{const style=node.style;style.cssText='';const cleared=style.cssText;node.removeAttribute('style');return{cleared};}],['stable-ref-double-remove',async(node)=>{const style=node.style;style.cssText='';const cleared=style.cssText;node.removeAttribute('style');node.removeAttribute('style');return{cleared};}],['stable-ref-computed-before-remove',async(node)=>{const style=node.style;style.cssText='';const cleared=style.cssText,computed=getComputedStyle(node).display;node.removeAttribute('style');return{cleared,computed};}],['stable-ref-bcr-before-remove',async(node)=>{const style=node.style;style.cssText='';const cleared=style.cssText,width=node.getBoundingClientRect().width;node.removeAttribute('style');return{cleared,width};}],['stable-ref-microtask-before-remove',async(node)=>{const style=node.style;style.cssText='';const cleared=style.cssText;await Promise.resolve();node.removeAttribute('style');return{cleared};}],['stable-ref-two-raf-before-remove',async(node)=>{const style=node.style;style.cssText='';const cleared=style.cssText;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);node.removeAttribute('style');return{cleared};}],['empty-attribute-stable-ref-remove',async(node)=>{node.setAttribute('style','');const style=node.style,cleared=style.cssText;node.removeAttribute('style');return{cleared};}],['stable-ref-read-only-remove',async(node)=>{const style=node.style,cleared=style.cssText;node.removeAttribute('style');return{cleared};}],['computed-then-stable-ref',async(node)=>{const computed=getComputedStyle(node).display,style=node.style;style.cssText='';const cleared=style.cssText;node.removeAttribute('style');return{cleared,computed};}]],records=[];for(const [name,operation] of definitions){const node=document.createElement('span');node.setAttribute('data-sam-goal-first-style-touch-probe',name);ancestor.append(node);const initial=raw(node),operationEvidence=await operation(node),immediate=raw(node);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const preStyleAccess=raw(node),cssText=node.style.cssText,postStyleAccess=raw(node);records.push({name,initial,operationEvidence,immediate,preStyleAccess,cssText,postStyleAccess});node.remove();}return{records,residue:document.querySelectorAll('[data-sam-goal-first-style-touch-probe]').length};})()`);
      process.stdout.write(`${JSON.stringify({ status: 'first_style_touch_trace', trace })}\n`);
      succeeded = true;
      return;
    }

    if (process.env.SAM_FOCUS_DIAG_ANCESTOR === '1') {
      const trace = await diagnoseAncestorRestore(gate, page, surface);
      process.stdout.write(`${JSON.stringify({ status: 'ancestor_restore_trace', trace })}\n`);
      succeeded = true;
      return;
    }
    if (process.env.SAM_FOCUS_DIAG_EXACT_ANCESTOR === '1') {
      const trace = await gate.runAncestorCompositorGuardOracle(page, surface);
      process.stdout.write(`${JSON.stringify({ status: 'exact_ancestor_restore_trace', trace })}\n`);
      succeeded = true;
      return;
    }
    if (process.env.SAM_FOCUS_DIAG_BYPASS_ANCESTOR === '1') {
      const trace = await gate.runAncestorCompositorGuardOracle(page, surface);
      process.stdout.write(`${JSON.stringify({ status: 'bypass_ancestor_restore_trace', trace })}\n`);
      succeeded = true;
      return;
    }
    if (process.env.SAM_FOCUS_DIAG_FLUSH_ANCESTOR === '1') {
      const trace = await gate.runAncestorCompositorGuardOracle(page, surface);
      process.stdout.write(`${JSON.stringify({ status: 'flush_ancestor_restore_result', trace })}\n`);
      succeeded = true;
      return;
    }
    if (process.env.SAM_FOCUS_DIAG_FINAL_RESTORE_ANCESTOR === '1') {
      const trace = await gate.runAncestorCompositorGuardOracle(page, surface);
      const postRaw = await evaluate(page, `(()=>{const ancestor=document.getElementById(${JSON.stringify(surface.targetId)})?.parentElement?.parentElement;const cssText=ancestor.style.cssText;return{cssText,hasAttribute:ancestor.hasAttribute('style'),attribute:ancestor.hasAttribute('style')?ancestor.getAttribute('style'):null};})()`);
      assert.deepEqual(postRaw, { cssText: '', hasAttribute: false, attribute: null });
      process.stdout.write(`${JSON.stringify({ status: 'final_restore_ancestor_result', trace, postRaw })}\n`);
      succeeded = true;
      return;
    }

    const ancestorOracle = await gate.runAncestorCompositorGuardOracle(page, surface);
    assert.deepEqual({ firstCode: ancestorOracle.firstCode, screenshotCaptureCount: ancestorOracle.screenshotCaptureCount }, { firstCode: 'presentation_ancestor_compositor_effect_forbidden', screenshotCaptureCount: 0 });
    const ancestorReplay = ancestorOracle.cspRawStyleReplayBaselineOracle;
    assert.equal(ancestorReplay.authorityVersion, 'ancestor-csp-raw-style-replay-baseline-v1');
    assert.equal(ancestorReplay.allReplayExact, true);
    assert.equal(ancestorReplay.baselineExact, true);
    assert.equal(ancestorReplay.triStateExact, true);
    assert.equal(ancestorReplay.baselineStyleAccessPreserved, true);
    assert.equal(ancestorReplay.settledStyleAccessPreserved, true);
    assert.equal(ancestorReplay.probeRemoved, true);
    assert.equal(ancestorReplay.captureEpochExact, true);
    assert.equal(ancestorReplay.rafCount, 2);
    assert.deepEqual(ancestorReplay.failures, []);
    const cleanAbsentFirstTouch = ancestorReplay.triState.firstTouchCleanAbsentOracle;
    assert.equal(cleanAbsentFirstTouch.authorityVersion, 'connected-clean-absent-first-touch-style-replay-v1');
    assert.equal(cleanAbsentFirstTouch.styleAccessBeforeReplay, false);
    assert.equal(cleanAbsentFirstTouch.connectedBeforeReplay, true);
    assert.equal(cleanAbsentFirstTouch.connectedAfterReplay, true);
    assert.equal(cleanAbsentFirstTouch.exact, true);
    assert.deepEqual(cleanAbsentFirstTouch.replay.evidence.currentRaw, { hasAttribute: false, attribute: null });
    assert.equal(cleanAbsentFirstTouch.replay.evidence.preReplayCssText, '');
    assert.equal(cleanAbsentFirstTouch.replay.evidence.clearMode, 'current-absent-read-only');
    assert.equal(cleanAbsentFirstTouch.replay.evidence.cssomClearWriteApplied, false);
    assert.deepEqual(cleanAbsentFirstTouch.replay.evidence.clearState, { hasAttribute: false, attribute: null, cssText: '' });
    assert.deepEqual(cleanAbsentFirstTouch.postReplayRaw, { hasAttribute: false, attribute: null });
    const rawPresentFirstTouch = ancestorReplay.triState.rawPresentFirstTouchOracle;
    assert.equal(rawPresentFirstTouch.authorityVersion, 'connected-raw-present-first-touch-style-replay-v1');
    assert.equal(rawPresentFirstTouch.styleAccessBeforeReplay, false);
    assert.equal(rawPresentFirstTouch.connectedBeforeReplay, true);
    assert.equal(rawPresentFirstTouch.connectedAfterReplay, true);
    assert.equal(rawPresentFirstTouch.exact, true);
    assert.deepEqual(rawPresentFirstTouch.replay.evidence.currentRaw, { hasAttribute: true, attribute: 'outline: 1px;' });
    assert.equal(rawPresentFirstTouch.replay.evidence.preReplayCssText, '');
    assert.equal(rawPresentFirstTouch.replay.evidence.clearMode, 'current-present-cssom-write');
    assert.equal(rawPresentFirstTouch.replay.evidence.cssomClearWriteApplied, true);
    assert.deepEqual(rawPresentFirstTouch.replay.evidence.clearState, { hasAttribute: true, attribute: '', cssText: '' });
    assert.deepEqual(rawPresentFirstTouch.postReplayRaw, { hasAttribute: false, attribute: null });
    const absentTwoRaf = ancestorReplay.triState.absentTwoRafOracle;
    assert.equal(absentTwoRaf.authorityVersion, 'absent-final-remove-two-raf-style-access-v1');
    assert.equal(absentTwoRaf.finalWriteKind, 'absent-remove-attribute');
    assert.deepEqual(absentTwoRaf.immediateRaw, { hasAttribute: false, attribute: null });
    assert.deepEqual(absentTwoRaf.preStyleAccessRaw, { hasAttribute: false, attribute: null });
    assert.equal(absentTwoRaf.cssTextAfterBarrier, '');
    assert.deepEqual(absentTwoRaf.postStyleAccessRaw, { hasAttribute: false, attribute: null });
    assert.equal(absentTwoRaf.rafCount, 2);
    assert.equal(absentTwoRaf.exact, true);
    assert.equal(ancestorOracle.transitionalReplayEvidence.authorityVersion, 'csp-aware-raw-style-attribute-replay-v1');
    assert.equal(ancestorOracle.transitionalReplayEvidence.replayOrder, 'current-raw-aware-preparation-then-tristate-final-write-v3');
    assert.equal(ancestorOracle.transitionalReplayEvidence.rawExact, true);
    assert.equal(ancestorOracle.transitionalReplayEvidence.cssomExact, true);
    assert.equal(ancestorOracle.finalReplayEvidence.authorityVersion, 'csp-aware-raw-style-attribute-replay-v1');
    assert.equal(ancestorOracle.finalReplayEvidence.replayOrder, 'current-raw-aware-preparation-then-tristate-final-write-v3');
    assert.equal(ancestorOracle.finalReplayEvidence.rawExact, true);
    assert.equal(ancestorOracle.finalReplayEvidence.cssomExact, true);
    const pseudoOracle = await gate.runPseudoCompositorGuardOracle(page, surface);
    assert.equal(pseudoOracle.firstCode, 'presentation_pseudo_compositor_effect_forbidden');
    assert.equal(pseudoOracle.screenshotCaptureCount, 0);
    assert.equal(pseudoOracle.injectedStyleElementCount, 0);
    assert.equal(pseudoOracle.cssom.cssomInsertRuleApplied, true);
    assert.equal(pseudoOracle.cssom.cssomDeleteRuleApplied, true);
    assert.equal(pseudoOracle.cssom.exactRulesRestored, true);
    assert.equal(pseudoOracle.cssom.markerRuleCountAfterCleanup, 0);
    log('ancestor_and_pseudo_oracles_passed');

    const nonceDomOracles = await gate.runPresentationNonceDomMutationOracles(page, surface, captureDir);
    assert.deepEqual(nonceDomOracles.map((oracle) => oracle.mutation), [
      'dom-backing-width-plus-one',
      'dom-canvas-css-left-plus-one',
      'dom-canvas-css-width-plus-one',
      'dom-canvas-transform',
      'dom-host-contain-fixed-cb',
      'dom-G-readback-one-pixel',
    ]);
    assert.deepEqual(nonceDomOracles.map((oracle) => oracle.firstCode), [
      'presentation_background_nonce_canvas_state_invalid',
      'presentation_background_nonce_canvas_state_invalid',
      'presentation_background_nonce_canvas_state_invalid',
      'presentation_background_nonce_compositor_effect_forbidden',
      'presentation_background_nonce_compositor_effect_forbidden',
      'presentation_background_nonce_canvas_readback_mismatch',
    ]);
    assert.ok(nonceDomOracles.every((oracle) => oracle.rejectedBeforeContentEligibility === true
      && oracle.screenshotCaptureCount === 0
      && oracle.destinationCreated === false
      && oracle.outputPathAbsent === true
      && oracle.freshInstallRestoreCycle === true
      && oracle.exactStyleRestored === true
      && oracle.nonceNodeCountAfterRestore === 0
      && oracle.zeroedBackingStore.width === 0
      && oracle.zeroedBackingStore.height === 0));
    assert.deepEqual(attemptResidue(tempRoot), []);
    log('nonce_dom_mutation_oracles_passed', { mutations: nonceDomOracles.map((oracle) => oracle.mutation) });

    const failureOracles = await gate.runCompositorFailureOracles(page, surface, captureDir);
    assert.deepEqual(Object.keys(failureOracles), ['stateDrift', 'staleRegion', 'changingRegion']);
    for (const oracle of Object.values(failureOracles)) {
      assert.equal(oracle.firstCode, 'presentation_compositor_unstable');
      assert.equal(oracle.screenshotCaptureCount, 8);
      assert.equal(oracle.destinationCreated, false);
      assert.equal(oracle.attemptPngResidue, 0);
    }
    log('compositor_failure_oracles_passed');

    const problemSource = sourceCases.find((source) => source.clipId === 'shorts-vc0GDveRIp0-16x9-padded');
    assert.ok(problemSource, 'problem source missing');
    const focusedProblemSource = { ...problemSource, spots: [problemSource.spots[0]] };
    assert.equal(focusedProblemSource.spots[0].sourceFrameIndex, 0);
    const real = await gate.runRealSources(page, surface, mode, [focusedProblemSource], captureDir);
    assert.equal(real.records.length, 4);
    assert.equal(real.compositorStabilities.length, 16);
    assert.deepEqual(real.records.map((record) => ({ viewport: record.viewport, targetedDsf2: record.targetedDsf2 })), EXPECTED_REAL_CASES.map(({ viewport, targetedDsf2 }) => ({ viewport, targetedDsf2 })));
    for (const [index, record] of real.records.entries()) {
      const expected = EXPECTED_REAL_CASES[index];
      assert.equal(record.clipId, 'shorts-vc0GDveRIp0-16x9-padded');
      assert.equal(record.sourceFrameIndex, 0);
      assert.deepEqual(record.planeNames, ['background', 'solid', 'reference', 'target']);
      assert.deepEqual(record.planeCompositorStability.map((item) => item.state), record.planeNames);
      if (expected.targetedDsf2) {
        const stale = record.staleBackgroundOracle;
        assert.equal(stale.firstCode, 'presentation_background_nonce_mismatch');
        assert.equal(stale.auxiliaryTargetAsBackgroundFirstCode, 'presentation_background_nonce_mismatch');
        assert.equal(stale.sameCaseBindingKeySha256, true);
        assert.equal(stale.captureChallengeSha256Distinct, true);
        assert.equal(stale.nonceTokenDistinct, true);
        assert.equal(stale.distinctPatternSha256, true);
        assert.equal(stale.distinctPatternBits, true);
        assert.equal(stale.actualLayoutSha256Stable, true);
      } else {
        assert.equal(record.staleBackgroundOracle, null);
      }
    }
    assert.ok(real.records.every((record) => record.presentationMismatchPixels === 0 && record.pageTakeoverPixels === 0 && record.fullSsim >= 0.995 && record.bottomQuarterSsim >= 0.995 && record.intrinsicDirectSsim >= 0.995));
    const formerTimeoutRecord = real.records.find((record) => record.viewport.width === 1440
      && record.viewport.height === 1000
      && record.viewport.deviceScaleFactor === 1);
    assert.ok(formerTimeoutRecord, 'former timeout record missing');
    const formerTimeoutSolid = formerTimeoutRecord.planeCompositorStability.find((stability) => stability.state === 'solid');
    assert.ok(formerTimeoutSolid, 'former timeout solid stability missing');
    assert.equal(formerTimeoutSolid.timeoutMs, 5_000);
    assert.equal(formerTimeoutSolid.requiredConsecutiveCaptures, 2);
    assert.equal(formerTimeoutSolid.captures, 2);
    assert.equal(formerTimeoutSolid.attemptCount, 2);
    assert.ok(formerTimeoutSolid.elapsedMs < 5_000);
    assert.deepEqual(formerTimeoutSolid.attemptPngResidue, []);
    assert.deepEqual(formerTimeoutSolid.rejectedAttemptPngResidue, 0);
    assert.ok(formerTimeoutSolid.attempts.every((attempt) => attempt.timeout !== true
      && attempt.eligible === true
      && attempt.stateStable === true
      && attempt.expectedStateExact === true));
    assert.deepEqual(attemptResidue(tempRoot), []);
    log('problem_real_clip_passed', {
      records: real.records.length,
      stablePlanes: real.compositorStabilities.length,
      fullSsimMin: Math.min(...real.records.map((record) => record.fullSsim)),
      bottomQuarterSsimMin: Math.min(...real.records.map((record) => record.bottomQuarterSsim)),
      formerTimeoutSolid: {
        captures: formerTimeoutSolid.captures,
        attempts: formerTimeoutSolid.attemptCount,
        elapsedMs: formerTimeoutSolid.elapsedMs,
      },
      pVsMeasuredF: real.records.map((record) => {
        const P = record.backgroundNonce.P;
        const F = record.physicalRasterAuthority.F.observedCoverageBbox;
        return {
          viewport: record.viewport,
          P,
          F,
          signedEdgeDelta: {
            left: P.x - F.x,
            top: P.y - F.y,
            right: P.x + P.width - (F.x + F.width),
            bottom: P.y + P.height - (F.y + F.height),
          },
        };
      }),
    });

    const synthetic = await gate.runSyntheticSources(page, surface, mode, captureDir);
    assert.equal(synthetic.records.length, 12);
    assert.equal(synthetic.compositorStabilities.length, 48);
    assert.deepEqual(attemptResidue(tempRoot), []);
    log('synthetic_passed', { records: synthetic.records.length, stablePlanes: synthetic.compositorStabilities.length });

    const negatives = await gate.runNegativeControls(page, surface, mode, captureDir);
    assert.equal(negatives.records.length, 8);
    assert.equal(negatives.baselineCoverages.length, 2);
    assert.equal(negatives.frozenNonceCorruptionOracles.length, 2);
    assert.equal(negatives.preparationEvidences.length, 2);
    assert.equal(negatives.compositorStabilities.length, 24);
    assert.ok(negatives.records.every((record) => record.contentProbes.length === 2));
    assert.deepEqual(negatives.baselineCoverages.map((coverage) => coverage.deviceScaleFactor), [1, 2]);
    assert.deepEqual(negatives.preparationEvidences.map((evidence) => evidence.deviceScaleFactor), [1, 2]);
    for (const evidence of negatives.preparationEvidences) {
      const postSynthetic = evidence.postSyntheticTransition;
      assert.equal(postSynthetic.authorityVersion, 'post-synthetic-to-negative-natural-viewport-preparation-v1');
      assert.equal(postSynthetic.before.stage.inline.alignItems, '');
      assert.equal(postSynthetic.before.stage.computed.alignItems, 'center');
      assert.equal(postSynthetic.after.stage.inline.alignItems, '');
      assert.equal(postSynthetic.after.stage.computed.alignItems, 'center');
      assert.equal(postSynthetic.intrinsicExact, true);
      assert.equal(postSynthetic.rawStylesExact, true);
      assert.equal(postSynthetic.captureEpochExact, true);
      assert.equal(postSynthetic.stageScrollExact, true);
      assert.equal(postSynthetic.domStyleWriteCount, 0);
      assert.equal(postSynthetic.mutationRepairWriteCount, 0);
      assert.deepEqual(postSynthetic.beforeScrollState.stage, { left: 0, top: 0 });
      assert.deepEqual(postSynthetic.afterScrollState.stage, { left: 0, top: 0 });
      assert.equal(postSynthetic.guard.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1');
      assert.equal(postSynthetic.guard.exact, true);
      assert.equal(postSynthetic.guard.writeCount, 0);
      assert.equal(postSynthetic.guard.clampApplied, false);
      const policy = evidence.alignmentPolicyTransition;
      assert.equal(policy.authorityVersion, 'negative-initial-flex-start-alignment-policy-transition-v1');
      assert.equal(policy.before.stageInlineAlignItems, '');
      assert.equal(policy.before.stageComputedAlignItems, 'center');
      assert.equal(policy.after.stageInlineAlignItems, 'flex-start');
      assert.equal(policy.after.stageComputedAlignItems, 'flex-start');
      assert.equal(policy.styleWriteCount, 1);
      assert.equal(policy.scrollWriteCount, 0);
      assert.equal(policy.mutationRepairWriteCount, 0);
      assert.deepEqual(policy.after.targetRaw, policy.before.targetRaw);
      assert.deepEqual(policy.after.targetRect, policy.before.targetRect);
      assert.deepEqual(policy.after.stageRect, policy.before.stageRect);
      assert.equal(policy.before.targetRect.top, 212);
      assert.equal(policy.before.stageRect.top, 212.03125);
      assert.equal(policy.before.targetRect.top - policy.before.stageRect.top, -0.03125);
      assert.equal(policy.after.targetRect.top - policy.after.stageRect.top, -0.03125);
      assert.deepEqual(policy.after.rootScroll, policy.before.rootScroll);
      assert.deepEqual(policy.after.stageScroll, { left: 0, top: 0 });
      assert.deepEqual(policy.after.nestedScrollOffsets, policy.before.nestedScrollOffsets);
      assert.equal(policy.after.captureEpoch, policy.before.captureEpoch);
      const legacy = evidence.legacyTransitionOracle;
      assert.equal(legacy.authorityVersion, 'post-synthetic-to-flex-start-legacy-capture-transition-v1');
      assert.equal(legacy.centeredOverflowOffsetCssPx, -230);
      assert.equal(legacy.formerCenteredTop, -18);
      assert.equal(legacy.alignedFormalTopCssPx, 212);
      assert.equal(legacy.alignedStageTopCssPx, 212.03125);
      assert.equal(legacy.formalStageTopDeltaCssPx, -0.03125);
      assert.equal(legacy.expectedFormalInlineTop, '-0.03125px');
      const horizontalGrowth = (360 - policy.after.targetRect.width) / 2;
      const expectedLegacyRect = {
        left: policy.after.targetRect.left - horizontalGrowth,
        top: policy.after.targetRect.top,
        right: policy.after.targetRect.right + horizontalGrowth,
        bottom: policy.after.targetRect.top + 640,
        width: 360,
        height: 640,
      };
      assert.equal(horizontalGrowth, 18);
      assert.deepEqual(legacy.expectedTargetRect, expectedLegacyRect);
      if (evidence.deviceScaleFactor === 1) {
        assert.equal(policy.after.targetRect.left, 306);
        assert.equal(legacy.expectedTargetRect.left, 288);
      } else {
        assert.equal(policy.after.targetRect.left, 305);
        assert.equal(legacy.expectedTargetRect.left, 287);
      }
      assert.deepEqual(legacy.expectedStageScroll, { left: 0, top: 0 });
      assert.equal(legacy.captureReadyBeforeAnyScreenshot, true);
      assert.equal(legacy.mutationRepairWriteCount, 0);
      assert.equal(legacy.guard.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1');
      assert.equal(legacy.guard.exact, true);
      assert.equal(legacy.guard.writeCount, 0);
      assert.equal(legacy.guard.clampApplied, false);
      assert.equal(evidence.baselineGuard.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1');
      assert.equal(evidence.baselineGuard.exact, true);
    }
    for (const coverage of negatives.baselineCoverages) {
      const raster = coverage.physicalRasterAuthority;
      assert.equal(raster.authorityVersion, 'measured-F-exact-white-safe-interior-v2');
      assert.equal(raster.nominalDAuthority, false);
      assert.equal(raster.nominalCAuthority, false);
      assert.equal(raster.solidWhiteOracle.exact, true);
      assert.equal(raster.gMinusFBackgroundOracle.exact, true);
      assert.equal(coverage.measuredPhysicalPixels, raster.F.changedPixels);
      assert.equal(coverage.referenceCoverage.changedPixels, coverage.measuredPhysicalPixels);
      assert.equal(coverage.targetCoverage.changedPixels, coverage.measuredPhysicalPixels);
      assert.deepEqual(coverage.referenceCoverage.observedCoverageBbox, raster.F.observedCoverageBbox);
      assert.deepEqual(coverage.targetCoverage.observedCoverageBbox, raster.F.observedCoverageBbox);
      assert.equal(coverage.nonceContextRestorationEvidence.authorityVersion, 'presentation-nonce-context-raw-authority-cssom-stability-v1');
      assert.equal(coverage.nonceContextRestorationEvidence.rawAttributeAndOwnedStateExact, true);
      assert.equal(coverage.nonceContextRestorationEvidence.historicalCssomDiagnosticOnly, true);
      assert.equal(coverage.nonceContextRestorationEvidence.readOnlySettleBarrierCount, 1);
      assert.equal(coverage.nonceContextRestorationEvidence.postFinalRawReplayCssomStable, true);
      assert.equal(coverage.nonceContextRestorationEvidence.postRestoreComputedAndGeometryVerifiedBeforeRepair, true);
      assert.equal(coverage.nonceContextRestorationEvidence.postRestoreRepairWrites, 0);
      assert.match(coverage.nonceContextRestorationEvidence.strictProjectionSha256, /^[0-9a-f]{64}$/u);
      const cspReplay = coverage.cspStyleReplayOracle;
      assert.equal(cspReplay.authorityVersion, 'csp-aware-raw-style-replay-chrome-regression-v1');
      assert.equal(cspReplay.replayAuthorityVersion, 'csp-aware-raw-style-attribute-replay-v1');
      assert.equal(cspReplay.source, 'raw-style-attribute-not-historical-cssom');
      assert.equal(cspReplay.triStateExact, true);
      assert.equal(cspReplay.rawAndCssomExact, true);
      assert.equal(cspReplay.immediateToSettledExact, true);
      assert.equal(cspReplay.activeComputedGeometryExact, true);
      assert.equal(cspReplay.captureEpochExact, true);
      assert.equal(cspReplay.rafCount, 2);
      assert.equal(cspReplay.probeRemoved, true);
      assert.equal(cspReplay.probeCountAfter, 0);
      assert.deepEqual(cspReplay.targets.immediate, cspReplay.targets.baseline);
      assert.deepEqual(cspReplay.targets.settled, cspReplay.targets.baseline);
      assert.deepEqual(cspReplay.triState.absent.raw, { hasAttribute: false, attribute: null, cssText: '' });
      assert.deepEqual(cspReplay.triState.empty.raw, { hasAttribute: true, attribute: '', cssText: '' });
      assert.equal(cspReplay.triState.nonempty.raw.attribute, cspReplay.triState.expectedNonempty);
      assert.equal(cspReplay.triState.nonempty.raw.cssText, cspReplay.triState.expectedNonempty);
      const alignedStage = coverage.backgroundNonce.alignedStageRestorationEvidence;
      assert.equal(alignedStage.authorityVersion, 'presentation-stage-raw-nonce-computed-geometry-restoration-v1');
      assert.equal(alignedStage.exact, true);
      assert.deepEqual(alignedStage.actual, alignedStage.expected);
      assert.equal(alignedStage.actual.stageStyle.backgroundColor, 'rgb(5, 7, 11)');
      assert.equal(alignedStage.actual.backgroundNonce, null);
      assert.equal(alignedStage.actual.backgroundNonceNodeCount, 0);
      const alignmentTrace = coverage.backgroundNonce.alignmentRestorationTrace;
      assert.equal(alignmentTrace.authorityVersion, 'negative-aligned-nonce-restoration-trace-v1');
      assert.equal(alignmentTrace.alignedProjectionExact, true);
      assert.equal(alignmentTrace.preNonce.formal.inline.width, '324px');
      assert.equal(alignmentTrace.preNonce.formal.inline.height, '576px');
      assert.equal(alignmentTrace.preNonce.formal.inline.maxWidth, 'none');
      assert.equal(alignmentTrace.preNonce.formal.inline.maxHeight, 'none');
      assert.equal(alignmentTrace.preRelease.formal.inline.width, '324px');
      assert.equal(alignmentTrace.preRelease.formal.inline.height, '576px');
      assert.equal(alignmentTrace.postRelease.formal.inline.width, '324px');
      assert.equal(alignmentTrace.postRelease.formal.inline.height, '576px');
      assert.equal(alignmentTrace.release.authorityVersion, 'presentation-formal-a-barrier-b-stability-v1');
      assert.equal(alignmentTrace.release.exact, true);
      const frozen = coverage.frozenNonceAuthority;
      assert.equal(frozen.authorityVersion, 'negative-frozen-presentation-background-nonce-v1');
      assert.equal(frozen.readerMode, 'frozen-negative-baseline-exact-v1');
      assert.equal(frozen.canonicalHashExact, true);
      assert.equal(frozen.deepFrozenExact, true);
      assert.equal(frozen.noPseudoOverlay, true);
      assert.match(frozen.authoritySha256, /^[0-9a-f]{64}$/u);
      assert.equal(frozen.screenshotBinding.measuredFMaskCanonicalSha256, raster.F.maskCanonicalSha256);
      if (coverage.deviceScaleFactor === 1) {
        assert.deepEqual(raster.domains.D, { x: 306, y: 212, width: 324, height: 576 });
        assert.deepEqual(raster.F.observedCoverageBbox, { x: 306, y: 211, width: 324, height: 576 });
        assert.equal(coverage.referenceCoverage.insideGeometryChangedPixels, 186_300);
        assert.equal(coverage.referenceCoverage.outsideGeometryChangedPixels, 324);
        assert.equal(coverage.targetCoverage.insideGeometryChangedPixels, 186_300);
        assert.equal(coverage.targetCoverage.outsideGeometryChangedPixels, 324);
        assert.equal(coverage.referenceCoverage.insideGeometryChangedPixels + coverage.referenceCoverage.outsideGeometryChangedPixels, coverage.measuredPhysicalPixels);
        assert.equal(coverage.targetCoverage.insideGeometryChangedPixels + coverage.targetCoverage.outsideGeometryChangedPixels, coverage.measuredPhysicalPixels);
        assert.equal(coverage.measuredFEqualsNominalD, false);
      }
    }
    const expectedFrozenCorruptionCodes = [
      'presentation_background_nonce_frozen_layout_mismatch',
      'presentation_background_nonce_frozen_layout_mismatch',
      'presentation_background_nonce_frozen_token_mismatch',
      'presentation_background_nonce_frozen_layout_mismatch',
      'presentation_background_nonce_frozen_visual_state_mismatch',
      'presentation_background_nonce_frozen_readback_mismatch',
    ];
    for (const oracle of negatives.frozenNonceCorruptionOracles) {
      assert.equal(oracle.corruptionCount, 6);
      assert.deepEqual(oracle.records.map((record) => record.corruption), ['layout', 'duplicate-host', 'token', 'context', 'visual', 'readback']);
      assert.deepEqual(oracle.records.map((record) => record.firstCode), expectedFrozenCorruptionCodes);
      assert.ok(oracle.records.every((record) => record.rejectedBeforeScreenshot === true
        && record.screenshotCaptureCount === 0
        && record.destinationCreated === false
        && record.attemptPngResidue === 0
        && record.exactPostRestoreState === true));
      for (const record of oracle.records) {
        const diagnostic = record.restorationDiagnostic;
        assert.equal(diagnostic.authorityVersion, 'frozen-corruption-final-raw-replay-settle-v1');
        assert.equal(diagnostic.postFinalRawReplayRafCount, 2);
        assert.equal(diagnostic.rawStyleExact, true);
        assert.equal(diagnostic.immediateToSeparateTaskExact, true);
        assert.equal(diagnostic.separateTaskToBarrierBExact, true);
        assert.equal(diagnostic.postFinalRawStable, true);
        assert.equal(diagnostic.postFinalCssomStable, true);
        assert.equal(diagnostic.postFinalRectStable, true);
        assert.equal(diagnostic.postFinalComputedStable, true);
        assert.equal(diagnostic.hostRectExact, true);
        assert.equal(diagnostic.formalRectExact, true);
        assert.equal(diagnostic.settleBarrier.authorityVersion, 'frozen-corruption-two-raf-bcr-computed-read-only-barrier-v1');
        assert.equal(diagnostic.settleBarrier.readOnly, true);
        assert.equal(diagnostic.settleBarrier.rafCount, 2);
        assert.deepEqual(diagnostic.canonical.hostRect, diagnostic.before.hostRect);
        assert.deepEqual(diagnostic.canonical.formalRect, diagnostic.before.formalRect);
      }
    }
    assert.deepEqual(negatives.styleAttributeTransition.before, { styleHasAttribute: false, styleAttribute: null, styleCssText: '' });
    assert.deepEqual(negatives.styleAttributeTransition.empty, { styleHasAttribute: true, styleAttribute: '', styleCssText: '' });
    assert.equal(negatives.styleAttributeTransition.nonempty.styleAttribute, 'outline: 0px;');
    assert.deepEqual(negatives.styleAttributeTransition.canonical, negatives.styleAttributeTransition.before);
    assert.equal(negatives.styleAttributeTransition.postFinalRawReplayRafCount, 2);
    assert.equal(negatives.styleAttributeTransition.absentAndEmptyDistinct, true);
    assert.equal(negatives.styleAttributeTransition.exactPostRafAndBcrRestoration, true);
    assert.equal(negatives.outerRestorationEvidences.length, 2);
    assert.ok(negatives.outerRestorationEvidences.every((evidence) => evidence.rawAttributeAndOwnedStateExact === true
      && evidence.historicalCssomDiagnosticOnly === true
      && evidence.postFinalRawReplayCssomStable === true
      && evidence.stageRestorationEvidence?.authorityVersion === 'presentation-stage-raw-nonce-computed-geometry-restoration-v1'
      && evidence.stageRestorationEvidence?.exact === true
      && JSON.stringify(evidence.stageRestorationEvidence?.actual) === JSON.stringify(evidence.stageRestorationEvidence?.expected)
      && evidence.stageRestorationEvidence?.actual?.stageStyle?.backgroundColor === 'rgb(5, 7, 11)'
      && evidence.stageRestorationEvidence?.actual?.backgroundNonce === null
      && evidence.stageRestorationEvidence?.actual?.backgroundNonceNodeCount === 0
      && evidence.postRestoreComputedAndGeometryVerifiedBeforeRepair === true
      && evidence.postRestoreRepairWrites === 0
      && /^[0-9a-f]{64}$/u.test(evidence.strictProjectionSha256)
      && /^[0-9a-f]{64}$/u.test(evidence.formalIntrinsicImageDataSha256)));
    const focusedEdgePlans = [];
    for (const record of negatives.records) for (const probe of record.contentProbes) {
      const baseline = negatives.baselineCoverages.find((coverage) => coverage.deviceScaleFactor === probe.deviceScaleFactor);
      const preparation = negatives.preparationEvidences.find((evidence) => evidence.deviceScaleFactor === probe.deviceScaleFactor);
      assert.equal(probe.frozenNonceAuthority.authoritySha256, baseline.frozenNonceAuthority.authoritySha256);
      assert.equal(probe.frozenNonceAuthority.readerMode, 'frozen-negative-baseline-exact-v1');
      assert.equal(probe.frozenNonceAuthority.layoutMetrics.visualExact, true);
      assert.equal(probe.frozenNonceAuthority.layoutMetrics.readbackExact, true);
      assert.equal(probe.rawAttributeAndOwnedStateExact, true);
      assert.equal(probe.historicalCssomDiagnosticOnly, true);
      assert.equal(probe.postFinalRawReplayCssomStable, true);
      assert.equal(probe.postRestoreComputedAndGeometryVerifiedBeforeRepair, true);
      assert.equal(probe.postRestoreRepairWrites, 0);
      assert.equal(probe.preCaptureGuardEvidence.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1');
      assert.equal(probe.preCaptureGuardEvidence.exact, true);
      assert.equal(probe.preCaptureGuardEvidence.writeCount, 0);
      assert.equal(probe.preCaptureGuardEvidence.clampApplied, false);
      assert.equal(probe.mutationViewportState.mutationRepairWriteCount, 0);
      assert.deepEqual(probe.mutationViewportState.stageScroll, { left: 0, top: 0 });
      assert.deepEqual(probe.mutationViewportState.stageAlignItems, { inline: 'flex-start', computed: 'flex-start' });
      assert.equal(probe.mutationViewportState.formalStageTopDeltaCssPx, preparation.legacyTransitionOracle.formalStageTopDeltaCssPx);
      assert.equal(probe.mutationViewportState.formalStageTopDeltaCssPx, -0.03125);
      assert.equal(probe.mutationViewportState.stageRect.top, 212.03125);
      assert.deepEqual(probe.preCaptureGuardEvidence.geometry, probe.frozenNonceAuthority.currentSelectedGeometry);
      if (record.mutation === 'legacy-intrinsic-scroll-layout') {
        const dpr = probe.deviceScaleFactor;
        const expectedLegacyRect = preparation.legacyTransitionOracle.expectedTargetRect;
        assert.deepEqual(probe.mutationViewportState.formalRect, probe.frozenNonceAuthority.currentSelectedGeometry.targetRect);
        assert.equal(probe.mutationViewportState.formalRect.top, preparation.legacyTransitionOracle.alignedFormalTopCssPx);
        assert.deepEqual(probe.frozenNonceAuthority.currentSelectedGeometry.targetRect, expectedLegacyRect);
        assert.deepEqual(probe.preCaptureGuardEvidence.D, { x: expectedLegacyRect.left * dpr, y: expectedLegacyRect.top * dpr, width: expectedLegacyRect.width * dpr, height: expectedLegacyRect.height * dpr });
        assert.deepEqual(probe.preCaptureGuardEvidence.G, { x: expectedLegacyRect.left * dpr - 2, y: expectedLegacyRect.top * dpr - 2, width: expectedLegacyRect.width * dpr + 4, height: expectedLegacyRect.height * dpr + 4 });
      }
      const edgeMatch = /^one-pixel-(top|right|bottom|left)-clip$/u.exec(record.mutation);
      if (edgeMatch) {
        const edge = edgeMatch[1];
        const dpr = probe.deviceScaleFactor;
        const nominalD = baseline.physicalRasterAuthority.domains.D;
        const expectedBbox = { ...baseline.physicalRasterAuthority.F.observedCoverageBbox };
        if (edge === 'top') {
          expectedBbox.y += dpr;
          expectedBbox.height -= dpr;
        } else if (edge === 'right') expectedBbox.width -= dpr;
        else if (edge === 'bottom') expectedBbox.height -= dpr;
        else {
          expectedBbox.x += dpr;
          expectedBbox.width -= dpr;
        }
        const expectedChanged = expectedBbox.width * expectedBbox.height;
        const expectedInside = rasterRegionIntersectionArea(expectedBbox, nominalD);
        const expectedOutside = expectedChanged - expectedInside;
        const signature = probe.content.mutationSignature;
        const preMeasuredF = baseline.physicalRasterAuthority.F.observedCoverageBbox;
        const nominalEdges = { top: nominalD.y, right: nominalD.x + nominalD.width, bottom: nominalD.y + nominalD.height, left: nominalD.x };
        const measuredEdges = { top: preMeasuredF.y, right: preMeasuredF.x + preMeasuredF.width, bottom: preMeasuredF.y + preMeasuredF.height, left: preMeasuredF.x };
        const nearEdge = edge === 'top' || edge === 'left';
        const signedGap = nearEdge ? measuredEdges[edge] - nominalEdges[edge] : nominalEdges[edge] - measuredEdges[edge];
        const compensation = Math.max(0, signedGap);
        const insetDevice = compensation + dpr;
        const insetCss = insetDevice / dpr;
        const insets = { top: 0, right: 0, bottom: 0, left: 0 };
        insets[edge] = insetCss;
        if (edge === 'bottom' && dpr === 1) {
          assert.equal(signedGap, 1);
          assert.equal(compensation, 1);
          assert.equal(insetDevice, 2);
          assert.equal(insetCss, 2);
        }
        const requestedClipPath = `inset(${[insets.top, insets.right, insets.bottom, insets.left].map((value) => `${value}px`).join(' ')})`;
        assert.equal(signature.signature, `one-measured-css-pixel-${edge}-band-exact-v1`);
        assert.equal(signature.mutationContract, 'one-measured-css-pixel-edge-band-v1');
        assert.equal(signature.edgePlanAuthorityVersion, 'negative-measured-f-edge-clip-plan-v2');
        assert.equal(signature.requestedMeasuredBandCssPx, 1);
        assert.equal(signature.requestedMeasuredBandDevicePixels, dpr);
        assert.equal(signature.signedGapDevicePixels, signedGap);
        assert.equal(signature.compensationDevicePixels, compensation);
        assert.equal(signature.appliedInsetDevicePixels, insetDevice);
        assert.equal(signature.appliedInsetCssPx, insetCss);
        assert.deepEqual(signature.appliedInsetsCssPx, insets);
        assert.equal(signature.requestedClipPathCssText, requestedClipPath);
        assert.deepEqual(signature.preMeasuredF, preMeasuredF);
        assert.deepEqual(signature.expectedPostMeasuredF, expectedBbox);
        assert.equal(signature.planComputedOnceFromFrozenBaseline, true);
        assert.equal(signature.adaptiveReplanForbidden, true);
        assert.equal(signature.exact, true);
        assert.equal(signature.partitionExact, true);
        assert.equal(signature.measuredBandVisibilityExact, true);
        assert.deepEqual(signature.nominalD, nominalD);
        assert.deepEqual(signature.expectedTargetObservedCoverageBbox, expectedBbox);
        assert.deepEqual(signature.targetObservedCoverageBbox, expectedBbox);
        assert.equal(signature.expectedChangedPixels, expectedChanged);
        assert.equal(signature.expectedInsideGeometryChangedPixels, expectedInside);
        assert.equal(signature.expectedOutsideGeometryChangedPixels, expectedOutside);
        assert.equal(signature.insideGeometryChangedPixels, expectedInside);
        assert.equal(signature.outsideGeometryChangedPixels, expectedOutside);
        assert.equal(signature.insideGeometryChangedPixels + signature.outsideGeometryChangedPixels, signature.expectedChangedPixels);
        const binding = signature.baselineBinding;
        assert.equal(binding.authorityVersion, 'negative-measured-f-edge-baseline-binding-v1');
        assert.equal(binding.dpr, dpr);
        assert.deepEqual(binding.nominalD, nominalD);
        assert.deepEqual(binding.runtimeMeasuredF, preMeasuredF);
        assert.deepEqual(binding.publicMeasuredF, preMeasuredF);
        assert.deepEqual(binding.frozenScreenshotMeasuredF, preMeasuredF);
        assert.equal(binding.runtimeMeasuredFMaskCanonicalSha256, baseline.physicalRasterAuthority.F.maskCanonicalSha256);
        assert.equal(binding.publicMeasuredFMaskCanonicalSha256, binding.runtimeMeasuredFMaskCanonicalSha256);
        assert.equal(binding.frozenScreenshotMeasuredFMaskCanonicalSha256, binding.runtimeMeasuredFMaskCanonicalSha256);
        assert.equal(binding.caseBindingKeySha256, baseline.frozenNonceAuthority.caseBindingKeySha256);
        assert.equal(binding.frozenAuthoritySha256, baseline.frozenNonceAuthority.authoritySha256);
        assert.equal(signature.baselineBindingSha256, sha256(Buffer.from(JSON.stringify(binding))));
        const applied = signature.appliedClipPath;
        const plan = applied.plan;
        const { planCanonicalSha256, ...canonicalPlan } = plan;
        assert.equal(plan.baselineBindingSha256, signature.baselineBindingSha256);
        assert.equal(planCanonicalSha256, signature.planCanonicalSha256);
        assert.equal(planCanonicalSha256, sha256(Buffer.from(JSON.stringify(canonicalPlan))));
        assert.deepEqual(plan.nominalD, nominalD);
        assert.deepEqual(plan.preMeasuredF, preMeasuredF);
        assert.deepEqual(plan.expectedPostMeasuredF, expectedBbox);
        assert.equal(plan.signedGapDevicePixels, signedGap);
        assert.equal(plan.compensationDevicePixels, compensation);
        assert.equal(plan.appliedInsetDevicePixels, insetDevice);
        assert.equal(plan.appliedInsetCssPx, insetCss);
        assert.deepEqual(plan.appliedInsetsCssPx, insets);
        assert.equal(plan.requestedClipPathCssText, requestedClipPath);
        assert.equal(applied.preApplyNominalDExact, true);
        assert.deepEqual(applied.preApplyNominalD, nominalD);
        assert.equal(applied.baselineBindingExact, true);
        assert.equal(applied.baselineBindingSha256Exact, true);
        assert.equal(applied.planCanonicalSha256Exact, true);
        assert.equal(applied.bcrExact, true);
        assert.equal(applied.stageBcrExact, true);
        assert.equal(applied.rootScrollExact, true);
        assert.equal(applied.stageScrollExact, true);
        assert.deepEqual(applied.preApplyFormalRect, applied.postApplyFormalRect);
        assert.deepEqual(applied.preApplyStageRect, applied.postApplyStageRect);
        assert.deepEqual(applied.preApplyScroll, applied.postApplyScroll);
        assert.deepEqual(applied.preApplyStageScroll, applied.postApplyStageScroll);
        assert.equal(applied.requestedClipPathCssText, requestedClipPath);
        assert.deepEqual(applied.inlineInsetsCssPx, insets);
        assert.deepEqual(applied.computedInsetsCssPx, insets);
        assert.equal(applied.inlineClipPathPlanExact, true);
        assert.equal(applied.computedClipPathPlanExact, true);
        assert.equal(probe.content.presentationMismatchPixels, signature.expectedMismatchPixels);
        assert.equal(probe.content.pageTakeoverPixels, signature.expectedMismatchPixels);
        assert.equal(probe.content.edgeMismatchPixels[edge], signature.expectedMismatchPixels);
        assert.match(signature.antiStaleRegionSha256, /^[0-9a-f]{64}$/u);
        assert.equal(signature.antiStaleSourceCount, signature.antiStaleSourceDifferences.length);
        assert.ok(signature.antiStaleSourceCount >= 3);
        assert.ok(signature.antiStaleSourceDifferences.every((item) => item.different === true
          && /^[0-9a-f]{64}$/u.test(item.regionSha256)
          && item.regionSha256 !== signature.antiStaleRegionSha256));
        assert.equal(signature.antiStaleEachSourceDifferenceExact, true);
        assert.equal(signature.antiStaleDifferenceExact, true);
        focusedEdgePlans.push({ dpr, edge, signedGap, compensation, insetDevice, insetCss, preMeasuredF, expectedBbox });
      }
      assert.equal(probe.postRestoreGeometryFirstCode, null);
      assert.deepEqual(probe.postRestoreIntrinsic, { width: 360, height: 640 });
      assert.equal(probe.postRestoreFormalIntrinsicImageDataSha256, probe.baselineFormalIntrinsicImageDataSha256);
      assert.match(probe.postRestoreFrozenProjectionSha256, /^[0-9a-f]{64}$/u);
      assert.deepEqual(probe.postRestorePhysicalEdges, probe.targetPhysicalEdges);
    }
    assert.deepEqual(attemptResidue(tempRoot), []);
    log('negative_controls_passed', { records: negatives.records.length, stablePlanes: negatives.compositorStabilities.length, frozenCorruptionOracles: negatives.frozenNonceCorruptionOracles.reduce((sum, oracle) => sum + oracle.corruptionCount, 0), edgePlans: focusedEdgePlans });

    const nonceCaptures = [
      ...real.records.map((record) => ({ record, lifecycleClass: 'real' })),
      ...synthetic.records.map((record) => ({ record, lifecycleClass: 'synthetic' })),
      ...negatives.baselineCoverages.map((record) => ({ record, lifecycleClass: 'negative-baseline' })),
    ];
    assert.equal(nonceCaptures.length, 18);
    const focusedCaptureEvidence = nonceCaptures.map(({ record, lifecycleClass }) => assertFocusedNonceCapture(record, lifecycleClass));
    const allOutputPaths = focusedCaptureEvidence.flatMap((item) => item.outputPaths);
    assert.equal(allOutputPaths.length, 72);
    assert.equal(new Set(allOutputPaths).size, 72);
    assert.equal(new Set(focusedCaptureEvidence.map((item) => item.challengeSha256)).size, 18);
    assert.equal(new Set(focusedCaptureEvidence.map((item) => item.nonceToken)).size, 18);
    log('focused_nonce_and_freshness_evidence_passed', {
      captureCount: nonceCaptures.length,
      globallyDistinctOutputPaths: new Set(allOutputPaths).size,
      distinctChallengeSha256: new Set(focusedCaptureEvidence.map((item) => item.challengeSha256)).size,
      distinctNonceTokens: new Set(focusedCaptureEvidence.map((item) => item.nonceToken)).size,
    });

    const stress = await gate.runTransitionStress(page, surface);
    assert.equal(stress.transitions, 10_000);
    assert.equal(stress.drift, 0);
    const stablePlaneCount = 1 + real.compositorStabilities.length + synthetic.compositorStabilities.length + negatives.compositorStabilities.length;
    assert.equal(stablePlaneCount, 89);
    assert.deepEqual(attemptResidue(tempRoot), []);
    log('transition_stress_and_residue_passed', { transitions: stress.transitions, stablePlaneCount });

    await closePage(page);
    page = null;
    await stopHeadedChrome(browser);
    browser = null;
    const serveExit = await stopServe(server);
    server = null;
    assert.deepEqual(attemptResidue(tempRoot), []);
    const finalFreeze = assertExactFreeze('post-focus');
    assert.deepEqual(finalFreeze, initialFreeze);
    succeeded = true;
    process.stdout.write(`${JSON.stringify({
      status: 'focus_passed',
      chromeProduct: EXPECTED_CHROME_PRODUCT,
      stablePlaneCount,
      realRecords: real.records.length,
      syntheticRecords: synthetic.records.length,
      negativeRecords: negatives.records.length,
      transitions: stress.transitions,
      serveExit: { status: serveExit.status, signal: serveExit.signal },
      freeze: finalFreeze,
      tempRoot,
    })}\n`);
  } finally {
    if (page) await closePage(page).catch(() => {});
    if (browser) await stopHeadedChrome(browser).catch(() => {});
    if (server) await stopServe(server, { strict: false }).catch(() => {});
    if (succeeded) rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
    else process.stderr.write(`${JSON.stringify({ status: 'focus_artifacts_preserved', tempRoot })}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: 'focus_failed',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    details: error?.details ?? null,
    stack: error?.stack ?? null,
  })}\n`);
  process.exitCode = 1;
});
