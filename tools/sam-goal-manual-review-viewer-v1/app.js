import { ExactStillDecoder } from '/exact-still-decoder.js';

const fetchJson = async (url, options) => { const response = await fetch(url, { cache: 'no-store', ...options }); const value = await response.json(); if (!response.ok || value.status === 'failed') throw Object.assign(new Error(value.code ?? `http_${response.status}`), { code: value.code ?? `http_${response.status}` }); return value; };
const [initialWorksheet, manifest, session] = await Promise.all([fetchJson('/api/worksheet'), fetchJson('/api/manifest'), fetchJson('/api/session')]);
const $ = (id) => document.getElementById(id);
const mutationHeaders = () => ({ 'content-type': 'application/json', 'x-sam-goal-csrf': session.csrfToken, 'x-sam-goal-session': session.sessionId });
const exactIdentity = (row) => ({ clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch });
const identityEqual = (left, right) => left && right && left.clipId === right.clipId && left.sourceFrameIndex === right.sourceFrameIndex && left.ptsTicks === right.ptsTicks && left.loopEpoch === right.loopEpoch && left.timeBase.numerator === right.timeBase.numerator && left.timeBase.denominator === right.timeBase.denominator;
const decimal = (row) => `${Number(BigInt(row.ptsTicks) * BigInt(row.timeBase.numerator) * 1_000_000n / BigInt(row.timeBase.denominator)) / 1_000_000} s`;
const isExplicitUnset = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && value.status === 'UNSET');
const containsUnset = (value) => { if (isExplicitUnset(value)) return true; if (Array.isArray(value)) return value.some(containsUnset); return Boolean(value && typeof value === 'object' && Object.values(value).some(containsUnset)); };

function sourcePointFromPointer(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width < 1 || canvas.height < 1 || rect.width <= 0 || rect.height <= 0) throw new Error('presentation_target_geometry_invalid');
  const rawX = (clientX - rect.left) * canvas.width / rect.width;
  const rawY = (clientY - rect.top) * canvas.height / rect.height;
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || rawX < 0 || rawY < 0 || rawX > canvas.width || rawY > canvas.height) throw new Error('presentation_pointer_outside_source');
  const pixelX = Math.max(0, Math.min(canvas.width - 1, Math.floor(rawX)));
  const pixelY = Math.max(0, Math.min(canvas.height - 1, Math.floor(rawY)));
  return { pixelX, pixelY, anchor: { x: canvas.width === 1 ? 0 : pixelX / (canvas.width - 1), y: canvas.height === 1 ? 0 : pixelY / (canvas.height - 1) } };
}

function syncInspectionCanvas(source, inspection) {
  if (source.width < 1 || source.height < 1) return;
  inspection.width = source.width; inspection.height = source.height;
  inspection.getContext('2d', { alpha: false }).drawImage(source, 0, 0);
}

function installPresentationControls({ target, stage, inspection, inspectionStage, fitButton, oneToOneButton }) {
  const setMode = (mode) => {
    if (!['fit', 'one-to-one'].includes(mode)) throw new Error('presentation_view_mode_invalid');
    stage.dataset.samGoalViewMode = mode;
    target.dataset.samGoalViewMode = 'fit';
    inspectionStage.dataset.samGoalViewMode = mode;
    inspectionStage.hidden = mode !== 'one-to-one';
    fitButton.setAttribute('aria-pressed', String(mode === 'fit'));
    oneToOneButton.setAttribute('aria-pressed', String(mode === 'one-to-one'));
    if (mode === 'one-to-one') syncInspectionCanvas(target, inspection);
  };
  fitButton.addEventListener('click', () => setMode('fit'));
  oneToOneButton.addEventListener('click', () => setMode('one-to-one'));
  setMode('fit');
  return { setMode, sync: () => syncInspectionCanvas(target, inspection) };
}

globalThis.__samGoalPresentationV3 = Object.freeze({
  interfaceId: 'sam_goal.manual_review_operations', interfaceVersion: 3,
  selectorAttribute: 'data-sam-goal-evidence-target', blindTarget: 'blind-exact-source-frame', revealTarget: 'reveal-exact-source-frame',
  sourcePointFromPointer,
});

function waitForMetadata(element) { if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(); return new Promise((resolve, reject) => { const success = () => { cleanup(); resolve(); }; const failure = () => { cleanup(); reject(new Error('motion_context_metadata_failed')); }; const cleanup = () => { element.removeEventListener('loadedmetadata', success); element.removeEventListener('error', failure); }; element.addEventListener('loadedmetadata', success); element.addEventListener('error', failure); }); }
async function settleMotionContextLayout() { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }

async function startBlindSourceReview() {
  let worksheet = initialWorksheet;
  const video = $('motion'); const canvas = $('still'); const context = canvas.getContext('2d', { alpha: false }); const stillDecoder = new ExactStillDecoder();
  const presentation = installPresentationControls({ target: canvas, stage: $('blindEvidenceStage'), inspection: $('stillInspection'), inspectionStage: $('blindInspectionStage'), fitButton: $('blindFit'), oneToOneButton: $('blindOneToOne') });
  let index = 0; let lockGeneration = session.generationBase; let activeLock = null; let activeDecode = null; let sessionClosed = false; let editBusy = false;
  const current = (generation) => generation === lockGeneration && !sessionClosed;

  async function updateMotionContext(row, generation) { const url = `/sources/${encodeURIComponent(row.clipId)}.mp4`; if (!video.getAttribute('src') || new URL(video.src, location.href).pathname !== url) { video.src = url; video.load(); } await waitForMetadata(video); if (!current(generation)) return; video.currentTime = Number(BigInt(row.ptsTicks) * BigInt(row.timeBase.numerator)) / row.timeBase.denominator; }
  function showEndBoundary() { const row = worksheet.rows[index]; const clipRows = worksheet.rows.filter((item) => item.clipId === row.clipId); const end = Number($('end').value); if (!Number.isSafeInteger(end) || end < 1 || end > clipRows.length) { $('endBoundary').textContent = 'INVALID'; return; } if (end < clipRows.length) { const boundary = clipRows[end]; $('endBoundary').textContent = `${boundary.clipId}:${boundary.sourceFrameIndex} pts=${boundary.ptsTicks} tb=${boundary.timeBase.numerator}/${boundary.timeBase.denominator}`; } else { const last = clipRows.at(-1); $('endBoundary').textContent = `${row.clipId}:${last.sourceFrameIndex + 1} terminal pts=${BigInt(last.ptsTicks) + 1n} tb=${last.timeBase.numerator}/${last.timeBase.denominator}`; } }
  function renderIdentity(row) { $('clip').textContent = row.clipId; $('frame').textContent = String(row.sourceFrameIndex); $('ticks').textContent = row.ptsTicks; $('base').textContent = `${row.timeBase.numerator}/${row.timeBase.denominator}`; $('epoch').textContent = String(row.loopEpoch); $('decimal').textContent = decimal(row); $('start').value = row.sourceFrameIndex; $('end').value = row.sourceFrameIndex + 1; $('jumpClip').value = row.clipId; $('jumpFrame').value = row.sourceFrameIndex; const windows = worksheet.windows.filter((window) => window.clipId === row.clipId && row.sourceFrameIndex >= window.startFrameIndex && row.sourceFrameIndex < window.endFrameIndexExclusive); $('currentValues').textContent = JSON.stringify({ scenarios: row.scenarios, manualState: row.manualState, coveringWindows: windows }, null, 2); const unresolvedRows = worksheet.rows.filter(containsUnset).length; const unresolvedWindows = worksheet.windows.filter(containsUnset).length; $('progress').textContent = `${worksheet.rows.length - unresolvedRows}/${worksheet.rows.length} rows and ${worksheet.windows.length - unresolvedWindows}/${worksheet.windows.length} windows contain no UNSET.`; showEndBoundary(); }
  function clearLocalLock() { const previous = activeLock; activeLock = null; activeDecode?.abort(); activeDecode = null; $('set').disabled = true; return previous; }
  async function releaseServerLock(lock) { if (!lock) return; try { await fetchJson('/api/unlock', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ clientGeneration: lock.generation, lockNonce: lock.nonce }) }); } catch {} }
  async function releaseStaleIssuedLock(generation, nonce) { try { await fetchJson('/api/unlock', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ clientGeneration: generation, lockNonce: nonce }) }); } catch {} }

  async function lock(row) {
    const generation = ++lockGeneration; const previous = clearLocalLock();
    await releaseServerLock(previous); if (!current(generation)) return;
    renderIdentity(row); $('lock').textContent = 'Decoding exact MP4 sample; no authoring identity is locked.';
    await updateMotionContext(row, generation).catch((error) => { if (current(generation)) $('motionStatus').textContent = error.code ?? error.message; });
    if (!current(generation)) return;
    await settleMotionContextLayout(); if (!current(generation)) return;
    const source = worksheet.sourceBinding.sources.find((item) => item.clipId === row.clipId); if (!source) throw new Error('source_binding_missing');
    const manifestRows = worksheet.rows.filter((item) => item.clipId === row.clipId); const controller = new AbortController(); activeDecode = controller;
    const decoded = await stillDecoder.decode({ clipId: row.clipId, url: `/sources/${encodeURIComponent(row.clipId)}.mp4`, expectedBytes: source.bytes, expectedSha256: source.sha256, manifestRows }, row.sourceFrameIndex, controller.signal);
    if (!current(generation) || controller.signal.aborted) { decoded.frame.close(); return; }
    try { canvas.width = decoded.frame.displayWidth; canvas.height = decoded.frame.displayHeight; context.drawImage(decoded.frame, 0, 0); presentation.sync(); } finally { decoded.frame.close(); }
    if (!current(generation)) return;
    const identity = exactIdentity(row); const claim = { identity, clientGeneration: generation, sampleToken: decoded.evidence.sampleToken, sourceByteSha256: decoded.sourceByteSha256, codedWidth: decoded.evidence.codedWidth, codedHeight: decoded.evidence.codedHeight, displayWidth: decoded.evidence.displayWidth, displayHeight: decoded.evidence.displayHeight, canvasWidth: canvas.width, canvasHeight: canvas.height };
    const issued = await fetchJson('/api/lock', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(claim) });
    if (!current(generation)) { if (issued.status === 'exact_frame_lock_issued') await releaseStaleIssuedLock(generation, issued.lockNonce); return; }
    if (issued.status !== 'exact_frame_lock_issued' || issued.clientGeneration !== generation) throw new Error(issued.code ?? 'frame_lock_rejected');
    await settleMotionContextLayout(); if (!current(generation)) { await releaseStaleIssuedLock(generation, issued.lockNonce); return; }
    activeLock = { generation, nonce: issued.lockNonce, identity }; activeDecode = null; $('set').disabled = false; $('lock').textContent = `Locked exact demux/WebCodecs sample ${row.clipId}:${row.sourceFrameIndex}; rational PTS ${row.ptsTicks} × ${row.timeBase.numerator}/${row.timeBase.denominator}.`;
  }
  async function move(delta) { if (sessionClosed) return; index = Math.max(0, Math.min(worksheet.rows.length - 1, index + delta)); const requestedGeneration = lockGeneration + 1; try { await lock(worksheet.rows[index]); } catch (error) { if (requestedGeneration === lockGeneration && error.code !== 'exact_decode_aborted') { $('lock').textContent = `LOCK FAILED: ${error.code ?? error.message}`; $('result').textContent = error.code ?? error.message; } } }

  $('previous').onclick = () => { if (!editBusy) void move(-1); }; $('next').onclick = () => { if (!editBusy) void move(1); };
  $('jump').onclick = () => { if (editBusy) return; const clipId = $('jumpClip').value; const sourceFrameIndex = $('jumpFrame').valueAsNumber; const nextIndex = worksheet.rows.findIndex((row) => row.clipId === clipId && row.sourceFrameIndex === sourceFrameIndex); if ($('jumpFrame').value === '' || !Number.isSafeInteger(sourceFrameIndex) || nextIndex < 0) { $('result').textContent = 'exact_jump_identity_invalid'; return; } index = nextIndex; void lock(worksheet.rows[index]).catch((error) => { if (error.code !== 'exact_decode_aborted') $('result').textContent = error.code ?? error.message; }); };
  $('set').onclick = async () => {
    const held = activeLock; const generation = lockGeneration;
    try {
      if (editBusy) throw new Error('edit_already_in_progress'); editBusy = true; for (const id of ['previous','next','jump','set']) $(id).disabled = true;
      const row = worksheet.rows[index]; if (!held || held.generation !== generation || !identityEqual(held.identity, exactIdentity(row))) throw new Error('exact_decoded_sample_identity_not_locked');
      const startFrameIndex = $('start').valueAsNumber; const endFrameIndexExclusive = $('end').valueAsNumber; if ($('start').value === '' || $('end').value === '' || !Number.isSafeInteger(startFrameIndex) || !Number.isSafeInteger(endFrameIndexExclusive)) throw new Error('edit_range_invalid');
      const common = { actorPseudonymSha256: manifest.actorPseudonymSha256, clientGeneration: generation, clipId: row.clipId, startFrameIndex, endFrameIndexExclusive, lockedIdentity: held.identity, lockNonce: held.nonce };
      const action = $('action').value === 'create-overlay' ? { action: 'create-overlay', ...common, windowId: $('field').value } : { action: $('action').value, ...common, fieldPath: $('field').value, valueType: $('valueType').value, value: JSON.parse($('value').value) };
      const result = await fetchJson('/api/edit', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(action) });
      if (!current(generation)) return; if (result.status !== 'explicit_edit_recorded' || result.clientGeneration !== generation) throw new Error(result.code ?? 'edit_rejected'); activeLock = null; $('set').disabled = true; const refreshed = await fetchJson('/api/worksheet'); if (!current(generation)) return; worksheet = refreshed; index = worksheet.rows.findIndex((item) => identityEqual(exactIdentity(item), held.identity)); if (index < 0) throw new Error('edited_identity_missing'); renderIdentity(worksheet.rows[index]); $('result').textContent = `${result.status}; journal sequence ${result.sequence}`;
    } catch (error) { if (current(generation)) $('result').textContent = error.code ?? error.message; } finally { editBusy = false; if (!sessionClosed) { $('previous').disabled = false; $('next').disabled = false; $('jump').disabled = false; $('set').disabled = !activeLock; } }
  };
  $('attest').onclick = async () => { try { const result = await fetchJson('/api/attest', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ actorPseudonymSha256: manifest.actorPseudonymSha256, actorDeclaredNoOutsideInput: true, cycleId: manifest.cycleId }) }); $('result').textContent = result.status; } catch (error) { $('result').textContent = error.code ?? error.message; } };
  $('endSession').onclick = async () => { if (sessionClosed) return; const generation = ++lockGeneration; const previous = clearLocalLock(); await releaseServerLock(previous); if (generation !== lockGeneration) return; try { const result = await fetchJson('/api/end-session', { method: 'POST', headers: mutationHeaders(), body: '{}' }); sessionClosed = true; for (const element of document.querySelectorAll('#blindReview button,#blindReview input,#blindReview select,#blindReview textarea')) element.disabled = true; $('result').textContent = result.status; } catch (error) { $('result').textContent = error.code ?? error.message; } };

  canvas.addEventListener('click', (event) => {
    if (!activeLock || sessionClosed || canvas.width < 1 || canvas.height < 1) return;
    try {
      const { pixelX, pixelY, anchor } = sourcePointFromPointer(canvas, event.clientX, event.clientY);
      $('field').value = 'subjectSelection/anchor'; $('valueType').value = 'anchor'; $('value').value = JSON.stringify(anchor);
      $('anchorCapture').textContent = `Captured intrinsic pixel x=${pixelX}, y=${pixelY}; normalized edit x=${anchor.x}, y=${anchor.y}; no visual marker is drawn.`;
    } catch {
      $('anchorCapture').textContent = 'Anchor rejected: outside intrinsic canvas.';
    }
  });
  $('end').addEventListener('input', showEndBoundary);
  await move(0);
}

function assertRevealView(view) {
  if (view?.artifactType !== 'sam-goal-adjudication-session-view-v1' || view.schemaVersion !== 1 || view.mode !== 'adjudication-reveal') throw new Error('adjudication_reveal_view_invalid');
  for (const key of ['rows', 'windows', 'disagreements', 'decisions', 'dispositionRecords']) if (!Array.isArray(view[key])) throw new Error(`adjudication_reveal_${key}_invalid`);
  if (!view.sourceBinding || !Array.isArray(view.sourceBinding.sources) || typeof view.actorPseudonymSha256 !== 'string' || view.actorPseudonymSha256.length !== 64) throw new Error('adjudication_reveal_binding_invalid');
}

function jsonText(value) {
  const rendered = JSON.stringify(value, null, 2);
  if (typeof rendered !== 'string') throw new Error('explicit_json_value_invalid');
  return rendered;
}

function parseExplicitJson(value) {
  if (value.trim() === '') throw new Error('explicit_json_value_required');
  return JSON.parse(value);
}

function makeElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.id) element.id = options.id;
  return element;
}

function appendDefinition(list, term, value) {
  list.append(makeElement('dt', { text: term }), makeElement('dd', { text: value }));
}

async function startAdjudicationReveal() {
  assertRevealView(initialWorksheet);
  let worksheet = initialWorksheet;
  let index = 0;
  let navigationGeneration = 0;
  let mutationGeneration = session.generationBase;
  let activeDecode = null;
  let editBusy = false;
  let sessionClosed = false;
  let lastServerCompletion = null;
  const stillDecoder = new ExactStillDecoder();
  const video = $('revealMotion');
  const canvas = $('revealStill');
  const context = canvas.getContext('2d', { alpha: false });
  const presentation = installPresentationControls({ target: canvas, stage: $('revealEvidenceStage'), inspection: $('revealStillInspection'), inspectionStage: $('revealInspectionStage'), fitButton: $('revealFit'), oneToOneButton: $('revealOneToOne') });

  const editorKey = (kind, parts) => `${kind}:${JSON.stringify(parts)}`;
  const decisionKey = (path, valueType) => JSON.stringify([path, valueType]);
  const setAnnouncement = (message, isError = false) => { $('revealResult').textContent = message; $('revealResult').classList.toggle('error', isError); };
  const setBusy = (busy) => { editBusy = busy; $('revealReview').setAttribute('aria-busy', String(busy)); for (const element of document.querySelectorAll('#revealReview button,#revealReview input,#revealReview select,#revealReview textarea')) element.disabled = busy || sessionClosed; };

  function exactDecisionMap() {
    const map = new Map();
    for (const record of worksheet.decisions) {
      const key = decisionKey(record.path, record.valueType);
      if (map.has(key)) throw new Error('adjudication_decision_duplicate');
      map.set(key, record);
    }
    return map;
  }

  function updateProgress() {
    const decisionsCompleteCount = worksheet.decisions.filter((record) => !containsUnset(record.decision)).length;
    const dispositionsCompleteCount = worksheet.dispositionRecords.filter((record) => !containsUnset(record.disposition) && !containsUnset(record.rationale)).length;
    $('revealDecisionProgress').textContent = `${decisionsCompleteCount}/${worksheet.decisions.length} decisions explicitly recorded; ${worksheet.decisions.length - decisionsCompleteCount} UNSET.`;
    $('revealDispositionProgress').textContent = `${dispositionsCompleteCount}/${worksheet.dispositionRecords.length} class dispositions and rationales explicitly recorded; ${worksheet.dispositionRecords.length - dispositionsCompleteCount} UNSET.`;
    $('revealOverallProgress').textContent = lastServerCompletion ? `Last server result: decisionsComplete=${lastServerCompletion.decisionsComplete}; dispositionsComplete=${lastServerCompletion.dispositionsComplete}.` : 'No mutation has been submitted in this browser session.';
  }

  function renderSourceIdentity() {
    if (worksheet.rows.length === 0) {
      $('revealIdentity').replaceChildren(makeElement('dd', { text: 'No C0 rows are present.' }));
      $('revealCurrentContext').textContent = jsonText({ c0Row: null, coveringC0Windows: [] });
      for (const id of ['revealPrevious', 'revealNext', 'revealJump']) $(id).disabled = true;
      return;
    }
    index = Math.max(0, Math.min(worksheet.rows.length - 1, index));
    const row = worksheet.rows[index];
    const identityList = $('revealIdentity');
    identityList.replaceChildren();
    appendDefinition(identityList, 'clipId', row.clipId);
    appendDefinition(identityList, 'sourceFrameIndex', String(row.sourceFrameIndex));
    appendDefinition(identityList, 'ptsTicks', row.ptsTicks);
    appendDefinition(identityList, 'timeBase', `${row.timeBase.numerator}/${row.timeBase.denominator}`);
    appendDefinition(identityList, 'loopEpoch', String(row.loopEpoch));
    appendDefinition(identityList, 'decimal context (non-authoritative)', decimal(row));
    $('revealJumpClip').value = row.clipId;
    $('revealJumpFrame').value = row.sourceFrameIndex;
    const coveringC0Windows = worksheet.windows.filter((window) => window.clipId === row.clipId && row.sourceFrameIndex >= window.startFrameIndex && row.sourceFrameIndex < window.endFrameIndexExclusive);
    $('revealCurrentContext').textContent = jsonText({ sourceIdentity: exactIdentity(row), c0Row: row, coveringC0Windows });
    $('revealPrevious').disabled = editBusy || sessionClosed || index === 0;
    $('revealNext').disabled = editBusy || sessionClosed || index === worksheet.rows.length - 1;
  }

  async function updateRevealMotion(row, generation) {
    const url = `/sources/${encodeURIComponent(row.clipId)}.mp4`;
    if (!video.getAttribute('src') || new URL(video.src, location.href).pathname !== url) { video.src = url; video.load(); }
    await waitForMetadata(video);
    if (generation !== navigationGeneration || sessionClosed) return;
    video.currentTime = Number(BigInt(row.ptsTicks) * BigInt(row.timeBase.numerator)) / row.timeBase.denominator;
  }

  async function decodeCurrentSource() {
    if (worksheet.rows.length === 0 || sessionClosed) return;
    const generation = ++navigationGeneration;
    activeDecode?.abort();
    const controller = new AbortController();
    activeDecode = controller;
    const row = worksheet.rows[index];
    renderSourceIdentity();
    $('revealDecodeStatus').textContent = `Decoding exact source sample ${row.clipId}:${row.sourceFrameIndex}.`;
    try {
      await updateRevealMotion(row, generation).catch((error) => { if (generation === navigationGeneration) $('revealMotionStatus').textContent = error.code ?? error.message; });
      if (generation !== navigationGeneration || sessionClosed) return;
      await settleMotionContextLayout(); if (generation !== navigationGeneration || sessionClosed) return;
      const source = worksheet.sourceBinding.sources.find((item) => item.clipId === row.clipId);
      if (!source) throw new Error('source_binding_missing');
      const manifestRows = worksheet.rows.filter((item) => item.clipId === row.clipId);
      const decoded = await stillDecoder.decode({ clipId: row.clipId, url: `/sources/${encodeURIComponent(row.clipId)}.mp4`, expectedBytes: source.bytes, expectedSha256: source.sha256, manifestRows }, row.sourceFrameIndex, controller.signal);
      if (generation !== navigationGeneration || controller.signal.aborted) { decoded.frame.close(); return; }
      try { canvas.width = decoded.frame.displayWidth; canvas.height = decoded.frame.displayHeight; context.drawImage(decoded.frame, 0, 0); presentation.sync(); } finally { decoded.frame.close(); }
      if (generation !== navigationGeneration || sessionClosed) return; await settleMotionContextLayout(); if (generation !== navigationGeneration || sessionClosed) return;
      $('revealDecodeStatus').textContent = `Exact source sample verified and displayed: ${row.clipId}:${row.sourceFrameIndex}; rational PTS ${row.ptsTicks} × ${row.timeBase.numerator}/${row.timeBase.denominator}.`;
    } catch (error) {
      if (generation === navigationGeneration && error.code !== 'exact_decode_aborted') { $('revealDecodeStatus').textContent = `SOURCE DECODE FAILED: ${error.code ?? error.message}`; setAnnouncement(error.code ?? error.message, true); }
    } finally {
      if (generation === navigationGeneration) activeDecode = null;
    }
  }

  function appendTypedValue(parent, label, value) {
    const wrapper = makeElement('div', { className: 'typed-value' });
    wrapper.append(makeElement('h4', { text: label }));
    const pre = makeElement('pre'); pre.textContent = jsonText(value); wrapper.append(pre); parent.append(wrapper);
  }

  function makeJsonEditor(labelText, id, value) {
    const wrapper = makeElement('label', { className: 'json-label' });
    wrapper.htmlFor = id;
    wrapper.append(document.createTextNode(labelText));
    const textarea = makeElement('textarea', { className: 'json-editor', id });
    textarea.rows = 5;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.value = jsonText(value);
    wrapper.append(textarea);
    return { wrapper, textarea };
  }

  function renderDecisionEditors() {
    const container = $('decisionEditors');
    container.replaceChildren();
    const decisions = exactDecisionMap();
    const disagreementKeys = new Set();
    worksheet.disagreements.forEach((disagreement, position) => {
      const key = decisionKey(disagreement.path, disagreement.valueType);
      if (disagreementKeys.has(key)) throw new Error('adjudication_disagreement_duplicate');
      disagreementKeys.add(key);
      const record = decisions.get(key);
      if (!record) throw new Error('adjudication_decision_missing');
      const fieldset = makeElement('fieldset', { className: 'editor-card' });
      fieldset.dataset.editorKey = editorKey('decision', [disagreement.path, disagreement.valueType]);
      const legend = makeElement('legend', { text: `Decision ${position + 1} of ${worksheet.disagreements.length}` });
      const state = makeElement('span', { className: containsUnset(record.decision) ? 'state-unset' : 'state-recorded', text: containsUnset(record.decision) ? 'UNSET' : 'RECORDED' });
      state.setAttribute('aria-label', `Decision state: ${state.textContent}`);
      const coordinate = makeElement('dl', { className: 'record-coordinate' });
      appendDefinition(coordinate, 'path', disagreement.path);
      appendDefinition(coordinate, 'valueType', disagreement.valueType);
      const contextGrid = makeElement('div', { className: 'typed-grid' });
      appendTypedValue(contextGrid, 'Review A typed value', disagreement.reviewAValue);
      appendTypedValue(contextGrid, 'Review B typed value', disagreement.reviewBValue);
      const editor = makeJsonEditor('Explicit adjudicated JSON value', `decision-value-${position}`, record.decision);
      const warning = makeElement('p', { className: 'warning compact', text: 'Applying or clearing this decision resets every disposition and rationale to explicit UNSET.' });
      const apply = makeElement('button', { text: 'Apply explicit decision' }); apply.type = 'submit'; apply.value = 'apply';
      const clear = makeElement('button', { text: 'Clear decision to UNSET' }); clear.type = 'submit'; clear.value = 'clear'; clear.className = 'secondary-action';
      fieldset.append(legend, state, coordinate, contextGrid, editor.wrapper, warning, apply, clear);
      const form = makeElement('form');
      form.dataset.kind = 'decision'; form.dataset.position = String(position); form.dataset.editorKey = fieldset.dataset.editorKey;
      form.append(fieldset); container.append(form);
    });
    if (decisions.size !== disagreementKeys.size) throw new Error('adjudication_decision_coordinate_set_invalid');
  }

  function renderDispositionEditors() {
    const container = $('dispositionEditors');
    container.replaceChildren();
    const dispositionKeys = new Set();
    worksheet.dispositionRecords.forEach((record, position) => {
      const key = editorKey('disposition', [record.coordinateKind, record.path, record.deviationClass]);
      if (dispositionKeys.has(key)) throw new Error('adjudication_disposition_duplicate');
      dispositionKeys.add(key);
      const fieldset = makeElement('fieldset', { className: 'editor-card' });
      fieldset.dataset.editorKey = key;
      const legend = makeElement('legend', { text: `Regenerated class ${position + 1} of ${worksheet.dispositionRecords.length}` });
      const complete = !containsUnset(record.disposition) && !containsUnset(record.rationale);
      const state = makeElement('span', { className: complete ? 'state-recorded' : 'state-unset', text: complete ? 'RECORDED' : 'UNSET' });
      state.setAttribute('aria-label', `Disposition state: ${state.textContent}`);
      const coordinate = makeElement('dl', { className: 'record-coordinate' });
      appendDefinition(coordinate, 'coordinateKind', record.coordinateKind);
      appendDefinition(coordinate, 'path', record.path);
      appendDefinition(coordinate, 'deviationClass', record.deviationClass);
      const dispositionEditor = makeJsonEditor('Explicit disposition JSON value', `disposition-value-${position}`, record.disposition);
      const rationaleEditor = makeJsonEditor('Explicit rationale JSON value', `rationale-value-${position}`, record.rationale);
      const apply = makeElement('button', { text: 'Apply explicit disposition and rationale' }); apply.type = 'submit'; apply.value = 'apply';
      const clear = makeElement('button', { text: 'Clear both to UNSET' }); clear.type = 'submit'; clear.value = 'clear'; clear.className = 'secondary-action';
      fieldset.append(legend, state, coordinate, dispositionEditor.wrapper, rationaleEditor.wrapper, apply, clear);
      const form = makeElement('form');
      form.dataset.kind = 'disposition'; form.dataset.position = String(position); form.dataset.editorKey = fieldset.dataset.editorKey;
      form.append(fieldset); container.append(form);
    });
  }

  function renderAllEditors() {
    renderDecisionEditors();
    renderDispositionEditors();
    updateProgress();
    renderSourceIdentity();
  }

  function validateMutationResponse(result, expectedGeneration) {
    const exactKeys = ['clientGeneration', 'decisionsComplete', 'dispositionsComplete', 'sequence', 'status'];
    const actualKeys = Object.keys(result).sort();
    if (actualKeys.length !== exactKeys.length || actualKeys.some((key, position) => key !== exactKeys[position])) throw new Error('adjudication_mutation_response_shape_invalid');
    if (result.status !== 'explicit_adjudication_recorded' || result.clientGeneration !== expectedGeneration || !Number.isSafeInteger(result.sequence) || typeof result.decisionsComplete !== 'boolean' || typeof result.dispositionsComplete !== 'boolean') throw new Error('adjudication_mutation_response_invalid');
  }

  async function refreshWorksheet(focusKey) {
    const previousIdentity = worksheet.rows[index] ? exactIdentity(worksheet.rows[index]) : null;
    const refreshed = await fetchJson('/api/worksheet');
    assertRevealView(refreshed);
    worksheet = refreshed;
    if (previousIdentity) {
      const refreshedIndex = worksheet.rows.findIndex((row) => identityEqual(exactIdentity(row), previousIdentity));
      index = refreshedIndex < 0 ? 0 : refreshedIndex;
    }
    renderAllEditors();
    if (focusKey) [...document.querySelectorAll('[data-editor-key]')].find((element) => element.dataset.editorKey === focusKey)?.querySelector('textarea,button')?.focus({ preventScroll: true });
  }

  async function submitMutation(form, submitter) {
    if (editBusy || sessionClosed) return;
    const kind = form.dataset.kind;
    const position = Number(form.dataset.position);
    const focusKey = form.dataset.editorKey;
    const clear = submitter?.value === 'clear';
    const clientGeneration = mutationGeneration + 1;
    let mutationAttempted = false;
    setBusy(true);
    setAnnouncement('Submitting one explicit adjudication mutation and waiting for authoritative refresh.');
    try {
      let body;
      if (kind === 'decision') {
        const disagreement = worksheet.disagreements[position];
        if (!disagreement) throw new Error('adjudication_disagreement_missing');
        const decision = clear ? { status: 'UNSET' } : parseExplicitJson($(`decision-value-${position}`).value);
        body = { action: 'set-decision', actorPseudonymSha256: worksheet.actorPseudonymSha256, clientGeneration, path: disagreement.path, valueType: disagreement.valueType, decision };
      } else if (kind === 'disposition') {
        const record = worksheet.dispositionRecords[position];
        if (!record) throw new Error('adjudication_disposition_missing');
        const disposition = clear ? { status: 'UNSET' } : parseExplicitJson($(`disposition-value-${position}`).value);
        const rationale = clear ? { status: 'UNSET' } : parseExplicitJson($(`rationale-value-${position}`).value);
        body = { action: 'set-disposition', actorPseudonymSha256: worksheet.actorPseudonymSha256, clientGeneration, coordinateKind: record.coordinateKind, path: record.path, deviationClass: record.deviationClass, disposition, rationale };
      } else {
        throw new Error('adjudication_editor_kind_invalid');
      }
      mutationGeneration = clientGeneration;
      mutationAttempted = true;
      const result = await fetchJson('/api/edit', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(body) });
      validateMutationResponse(result, clientGeneration);
      lastServerCompletion = { decisionsComplete: result.decisionsComplete, dispositionsComplete: result.dispositionsComplete };
      await refreshWorksheet(focusKey);
      const resetNotice = kind === 'decision' ? ' All dispositions were reloaded because every decision change resets them.' : '';
      setAnnouncement(`${result.status}; journal sequence ${result.sequence}.${resetNotice}`);
    } catch (error) {
      if (mutationAttempted) {
        try { await refreshWorksheet(focusKey); } catch (refreshError) { setAnnouncement(`${error.code ?? error.message}; refresh failed: ${refreshError.code ?? refreshError.message}`, true); return; }
        setAnnouncement(`${error.code ?? error.message}; the authoritative worksheet was refreshed after an ambiguous mutation outcome. Inspect the recorded value before retrying.`, true);
        return;
      }
      setAnnouncement(error.code ?? error.message, true);
    } finally {
      setBusy(false);
      renderSourceIdentity();
    }
  }

  $('decisionEditors').addEventListener('submit', (event) => { event.preventDefault(); void submitMutation(event.target, event.submitter); });
  $('dispositionEditors').addEventListener('submit', (event) => { event.preventDefault(); void submitMutation(event.target, event.submitter); });
  $('revealPrevious').addEventListener('click', () => { if (editBusy || index <= 0) return; index -= 1; void decodeCurrentSource(); });
  $('revealNext').addEventListener('click', () => { if (editBusy || index >= worksheet.rows.length - 1) return; index += 1; void decodeCurrentSource(); });
  $('revealJumpForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (editBusy) return;
    const clipId = $('revealJumpClip').value;
    const frameInput = $('revealJumpFrame');
    const sourceFrameIndex = frameInput.valueAsNumber;
    const nextIndex = worksheet.rows.findIndex((row) => row.clipId === clipId && row.sourceFrameIndex === sourceFrameIndex);
    if (frameInput.value === '' || !Number.isSafeInteger(sourceFrameIndex) || nextIndex < 0) { setAnnouncement('exact_jump_identity_invalid', true); return; }
    index = nextIndex; void decodeCurrentSource();
  });
  $('revealAttest').addEventListener('click', async () => {
    if (editBusy || sessionClosed) return;
    setBusy(true);
    try { const result = await fetchJson('/api/attest', { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ actorPseudonymSha256: worksheet.actorPseudonymSha256, actorDeclaredNoOutsideInput: true, cycleId: worksheet.cycleId }) }); setAnnouncement(result.status); } catch (error) { setAnnouncement(error.code ?? error.message, true); } finally { setBusy(false); renderSourceIdentity(); }
  });
  $('revealEndSession').addEventListener('click', async () => {
    if (editBusy || sessionClosed) return;
    setBusy(true); activeDecode?.abort(); activeDecode = null; navigationGeneration += 1;
    try { const result = await fetchJson('/api/end-session', { method: 'POST', headers: mutationHeaders(), body: '{}' }); sessionClosed = true; setAnnouncement(result.status); } catch (error) { setAnnouncement(error.code ?? error.message, true); } finally { setBusy(false); renderSourceIdentity(); }
  });

  const clipIds = [...new Set(worksheet.rows.map((row) => row.clipId))];
  $('revealJumpClip').replaceChildren(...clipIds.map((clipId) => { const option = makeElement('option', { text: clipId }); option.value = clipId; return option; }));
  renderAllEditors();
  await decodeCurrentSource();
}

if (manifest.mode === 'adjudication-reveal') {
  $('blindHeader').hidden = true;
  $('blindReview').hidden = true;
  $('revealHeader').hidden = false;
  $('revealReview').hidden = false;
  document.title = 'Adjudication Reveal Manual Review';
  try {
    await startAdjudicationReveal();
  } catch (error) {
    $('revealResult').textContent = `REVEAL INITIALIZATION FAILED: ${error.code ?? error.message}`;
    $('revealResult').classList.add('error');
  }
} else {
  $('revealHeader').hidden = true;
  $('revealReview').hidden = true;
  $('blindHeader').hidden = false;
  $('blindReview').hidden = false;
  document.title = 'SAM Goal Source-only Manual Review';
  await startBlindSourceReview();
}
