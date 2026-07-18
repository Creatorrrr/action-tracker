import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const EXPECTED_CHROME_PRODUCT = 'Chrome/150.0.7871.114';
export const DEFAULT_TARGET_ATTRIBUTE = 'data-sam-goal-evidence-target';

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;
const browserStates = new WeakMap();
const pageStates = new WeakMap();

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function timeoutError(label, timeoutMs) {
  return Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'headed_cdp_timeout' });
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function stringifySocketData(data) {
  if (typeof data === 'string') return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (ArrayBuffer.isView(data)) {
    return Promise.resolve(new TextDecoder().decode(data));
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return Promise.reject(new TypeError('Unsupported CDP WebSocket message payload'));
}

class CdpConnection {
  #socket;
  #nextRequestId = 1;
  #pending = new Map();
  #eventListeners = new Set();
  #closed = false;

  static async connect(url, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        try {
          socket.close();
        } catch {
          // The launch failure remains the primary error.
        }
        reject(timeoutError('CDP WebSocket connection', timeoutMs));
      }, timeoutMs);
      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Unable to connect to the CDP WebSocket at ${url}`));
      }, { once: true });
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      void this.#handleMessage(event.data);
    });
    socket.addEventListener('close', () => {
      this.#closeWithError(new Error('CDP WebSocket closed'));
    });
    socket.addEventListener('error', () => {
      this.#closeWithError(new Error('CDP WebSocket failed'));
    });
  }

  async #handleMessage(data) {
    let message;
    try {
      message = JSON.parse(await stringifySocketData(data));
    } catch (error) {
      this.#closeWithError(new Error(`Invalid CDP message: ${error.message}`));
      return;
    }

    if (Object.hasOwn(message, 'id')) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(
          `${pending.method} failed (${message.error.code}): ${message.error.message}`,
        );
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (!message.method) return;
    for (const listener of [...this.#eventListeners]) {
      try {
        listener(message);
      } catch {
        // A failed observer must not corrupt the request channel.
      }
    }
  }

  #closeWithError(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#eventListeners.clear();
  }

  send(method, params = {}, options = {}) {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}: CDP WebSocket is closed`));
    }
    const { sessionId, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = options;
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(timeoutError(method, timeoutMs));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      try {
        this.#socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  waitForEvent(method, options = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP WebSocket is closed'));
    const {
      sessionId,
      predicate = () => true,
      timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    } = options;
    return new Promise((resolve, reject) => {
      const listener = (message) => {
        if (message.method !== method) return;
        if (sessionId && message.sessionId !== sessionId) return;
        if (!predicate(message.params ?? {})) return;
        clearTimeout(timer);
        this.#eventListeners.delete(listener);
        resolve(message.params ?? {});
      };
      const timer = setTimeout(() => {
        this.#eventListeners.delete(listener);
        reject(timeoutError(method, timeoutMs));
      }, timeoutMs);
      this.#eventListeners.add(listener);
    });
  }

  async close() {
    if (this.#closed) return;
    const socket = this.#socket;
    const closed = new Promise((resolve) => {
      socket.addEventListener('close', resolve, { once: true });
    });
    try {
      socket.close(1000, 'test complete');
      await Promise.race([closed, delay(1_000)]);
    } finally {
      this.#closeWithError(new Error('CDP WebSocket closed by test harness'));
    }
  }
}

function processHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForProcessExit(child, timeoutMs) {
  if (processHasExited(child)) return true;
  let onExit;
  const exited = new Promise((resolve) => {
    onExit = () => resolve(true);
    child.once('exit', onExit);
  });
  const result = await Promise.race([exited, delay(timeoutMs).then(() => false)]);
  if (!result) child.off('exit', onExit);
  return result;
}

async function terminateProcess(child) {
  if (processHasExited(child)) return;
  child.kill('SIGTERM');
  if (await waitForProcessExit(child, 3_000)) return;
  child.kill('SIGKILL');
  await waitForProcessExit(child, 3_000);
}

async function waitForDevToolsEndpoint(profileDir, child, stderrTail, timeoutMs) {
  const activePortPath = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (processHasExited(child)) {
      throw new Error(
        `Headed Chrome exited before CDP became ready: ${stderrTail.value.trim() || 'no diagnostics'}`,
      );
    }
    try {
      const [portLine, browserPath] = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/u);
      const port = Number.parseInt(portLine, 10);
      if (!Number.isInteger(port) || port <= 0 || !browserPath) {
        throw new Error('DevToolsActivePort was incomplete');
      }
      const normalizedPath = browserPath.startsWith('/') ? browserPath : `/${browserPath}`;
      return {
        port,
        webSocketUrl: `ws://127.0.0.1:${port}${normalizedPath}`,
      };
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw new Error(
    `${timeoutError('Headed Chrome CDP launch', timeoutMs).message}; `
      + `${lastError?.message ?? 'no endpoint'}; ${stderrTail.value.trim() || 'no Chrome diagnostics'}`,
  );
}

function getBrowserState(browser) {
  const state = browserStates.get(browser);
  if (!state) throw new TypeError('Unknown headed Chrome handle');
  if (state.stopped) throw new Error('Headed Chrome has already stopped');
  return state;
}

function getPageState(page) {
  const state = pageStates.get(page);
  if (!state) throw new TypeError('Unknown CDP page handle');
  if (state.closed) throw new Error('CDP page has already closed');
  getBrowserState(state.browser);
  return state;
}

async function sendPage(page, method, params = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  const state = getPageState(page);
  const browserState = getBrowserState(state.browser);
  return browserState.connection.send(method, params, {
    sessionId: page.sessionId,
    timeoutMs,
  });
}

/**
 * Launches the declared Chrome build with a unique profile and no headless flag.
 * Browser.getVersion is checked before the handle is returned.
 */
export async function startHeadedChrome(options = {}) {
  const {
    launchTimeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    windowWidth = 1280,
    windowHeight = 720,
  } = options;
  assertPositiveInteger(windowWidth, 'windowWidth');
  assertPositiveInteger(windowHeight, 'windowHeight');
  assertPositiveInteger(launchTimeoutMs, 'launchTimeoutMs');
  assertPositiveInteger(commandTimeoutMs, 'commandTimeoutMs');

  const profileDir = await mkdtemp(join(tmpdir(), 'sam-goal-headed-chrome-'));
  const stderrTail = { value: '' };
  const child = spawn(CHROME_BINARY, [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--force-color-profile=srgb',
    `--window-size=${windowWidth},${windowHeight}`,
    'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrTail.value = `${stderrTail.value}${chunk}`.slice(-16_384);
  });

  let connection;
  try {
    const endpoint = await waitForDevToolsEndpoint(profileDir, child, stderrTail, launchTimeoutMs);
    connection = await CdpConnection.connect(endpoint.webSocketUrl, commandTimeoutMs);
    const version = await connection.send('Browser.getVersion', {}, { timeoutMs: commandTimeoutMs });
    if (version.product !== EXPECTED_CHROME_PRODUCT) {
      throw new Error(
        `headed_chrome_version_mismatch: expected ${EXPECTED_CHROME_PRODUCT}, got ${version.product ?? 'missing'}`,
      );
    }

    const browser = Object.freeze({
      kind: 'sam-goal-headed-chrome-cdp-v1',
      endpoint: endpoint.webSocketUrl,
      product: version.product,
      protocolVersion: version.protocolVersion,
      userAgent: version.userAgent,
    });
    browserStates.set(browser, {
      child,
      connection,
      pages: new Set(),
      profileDir,
      stderrTail,
      stopped: false,
    });
    return browser;
  } catch (error) {
    if (connection) await connection.close().catch(() => {});
    await terminateProcess(child).catch(() => {});
    await rm(profileDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    throw error;
  }
}

/** Stops the browser, closes tracked pages, and removes its isolated profile. */
export async function stopHeadedChrome(browser) {
  const state = browserStates.get(browser);
  if (!state || state.stopped) return;
  for (const page of [...state.pages]) {
    await closePage(page).catch(() => {});
  }
  state.stopped = true;
  await state.connection.close().catch(() => {});
  await terminateProcess(state.child).catch(() => {});
  await rm(state.profileDir, { recursive: true, force: true, maxRetries: 3 });
}

/** Creates a flattened CDP session for an isolated page target. */
export async function createPage(browser, options = {}) {
  const state = getBrowserState(browser);
  const { url = 'about:blank', timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = options;
  const { targetId } = await state.connection.send(
    'Target.createTarget',
    { url: 'about:blank' },
    { timeoutMs },
  );
  let sessionId;
  try {
    ({ sessionId } = await state.connection.send(
      'Target.attachToTarget',
      { targetId, flatten: true },
      { timeoutMs },
    ));
    await Promise.all([
      state.connection.send('Page.enable', {}, { sessionId, timeoutMs }),
      state.connection.send('Runtime.enable', {}, { sessionId, timeoutMs }),
      state.connection.send('DOM.enable', {}, { sessionId, timeoutMs }),
    ]);
  } catch (error) {
    await state.connection.send('Target.closeTarget', { targetId }, { timeoutMs }).catch(() => {});
    throw error;
  }

  const page = Object.freeze({
    kind: 'sam-goal-headed-chrome-page-v1',
    targetId,
    sessionId,
  });
  pageStates.set(page, { browser, closed: false });
  state.pages.add(page);
  if (url !== 'about:blank') await navigate(page, url, { timeoutMs });
  return page;
}

/** Closes a page target. Safe to call more than once. */
export async function closePage(page) {
  const pageState = pageStates.get(page);
  if (!pageState || pageState.closed) return;
  const browserState = browserStates.get(pageState.browser);
  pageState.closed = true;
  browserState?.pages.delete(page);
  if (!browserState || browserState.stopped) return;
  await browserState.connection.send('Target.closeTarget', { targetId: page.targetId });
}

/** Applies a CSS-pixel viewport and explicit device scale factor. */
export async function setViewport(page, viewport) {
  const { width, height, deviceScaleFactor } = viewport;
  assertPositiveInteger(width, 'viewport.width');
  assertPositiveInteger(height, 'viewport.height');
  assertFiniteNumber(deviceScaleFactor, 'viewport.deviceScaleFactor');
  if (deviceScaleFactor <= 0) {
    throw new RangeError('viewport.deviceScaleFactor must be greater than zero');
  }
  await sendPage(page, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
}

/** Navigates and waits until the page reports document.readyState === complete. */
export async function navigate(page, url, options = {}) {
  const { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = options;
  const result = await sendPage(page, 'Page.navigate', { url }, timeoutMs);
  if (result.errorText) throw new Error(`Page.navigate failed: ${result.errorText}`);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(page, 'document.readyState', { timeoutMs: Math.min(1_000, timeoutMs) }) === 'complete') {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(
    `${timeoutError(`navigation to ${url}`, timeoutMs).message}${lastError ? `: ${lastError.message}` : ''}`,
  );
}

/** Evaluates a JavaScript expression and returns its by-value result by default. */
export async function evaluate(page, expression, options = {}) {
  if (typeof expression !== 'string') throw new TypeError('expression must be a string');
  const {
    awaitPromise = true,
    returnByValue = true,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    userGesture = false,
  } = options;
  const response = await sendPage(page, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue,
    userGesture,
  }, timeoutMs);
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? 'unknown evaluation exception';
    throw new Error(`Runtime.evaluate failed: ${detail}`);
  }
  if (!returnByValue) return response.result;
  if (Object.hasOwn(response.result, 'value')) return response.result.value;
  return response.result.unserializableValue;
}

function targetSelector(targetName, attribute) {
  if (typeof targetName !== 'string' || !/^[A-Za-z0-9_.:-]+$/u.test(targetName)) {
    throw new TypeError('targetName must contain only letters, digits, dot, underscore, colon, or hyphen');
  }
  if (typeof attribute !== 'string' || !/^data-[a-z0-9-]+$/u.test(attribute)) {
    throw new TypeError('attribute must be a lowercase data-* attribute name');
  }
  return `[${attribute}="${targetName}"]`;
}

function boundsFromQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 8 || quad.some((value) => !Number.isFinite(value))) {
    throw new Error('DOM.getBoxModel returned an invalid border quad');
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width <= 0 || height <= 0) throw new Error('Named target has no rendered area');
  return { x, y, width, height };
}

/** Resolves the named target and reports both page-space and viewport-space geometry. */
export async function getNamedTargetGeometry(page, targetName, options = {}) {
  const { attribute = DEFAULT_TARGET_ATTRIBUTE } = options;
  const selector = targetSelector(targetName, attribute);
  const { root } = await sendPage(page, 'DOM.getDocument', { depth: 1, pierce: true });
  const { nodeId } = await sendPage(page, 'DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`Named target not found: ${selector}`);
  const [{ model }, metrics] = await Promise.all([
    sendPage(page, 'DOM.getBoxModel', { nodeId }),
    sendPage(page, 'Page.getLayoutMetrics'),
  ]);
  const bounds = boundsFromQuad(model.border);
  const visualViewport = metrics.cssVisualViewport ?? metrics.visualViewport;
  const pageX = visualViewport?.pageX ?? 0;
  const pageY = visualViewport?.pageY ?? 0;
  return {
    targetName,
    attribute,
    selector,
    nodeId,
    page: {
      x: bounds.x + pageX,
      y: bounds.y + pageY,
      width: bounds.width,
      height: bounds.height,
      quad: [...model.border],
    },
    viewport: { ...bounds },
  };
}

function validateScreenshotEncoding(format, quality) {
  if (!['png', 'jpeg', 'webp'].includes(format)) {
    throw new TypeError('format must be png, jpeg, or webp');
  }
  if (quality !== undefined && (!Number.isInteger(quality) || quality < 0 || quality > 100)) {
    throw new RangeError('quality must be an integer from 0 through 100');
  }
}

/** Captures the current visible viewport without applying a CDP clip rectangle. */
export async function captureViewportScreenshot(page, options = {}) {
  const {
    format = 'png',
    quality,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  } = options;
  validateScreenshotEncoding(format, quality);
  const params = {
    format,
    fromSurface: true,
    captureBeyondViewport: false,
  };
  if (quality !== undefined && format !== 'png') params.quality = quality;
  const { data } = await sendPage(page, 'Page.captureScreenshot', params, timeoutMs);
  return { data, format };
}

/** Dispatches a real CDP mouse move/press/release sequence at viewport CSS coordinates. */
export async function clickAt(page, coordinates, options = {}) {
  const { x, y } = coordinates;
  const { button = 'left', clickCount = 1, modifiers = 0 } = options;
  assertFiniteNumber(x, 'coordinates.x');
  assertFiniteNumber(y, 'coordinates.y');
  if (!['left', 'middle', 'right'].includes(button)) {
    throw new TypeError('button must be left, middle, or right');
  }
  assertPositiveInteger(clickCount, 'clickCount');
  const common = { x, y, button, clickCount, modifiers };
  await sendPage(page, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
  await sendPage(page, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...common });
  await sendPage(page, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...common });
}

/** Scrolls a named target into view and clicks a relative point inside its border box. */
export async function clickNamedTarget(page, targetName, options = {}) {
  const {
    attribute = DEFAULT_TARGET_ATTRIBUTE,
    relativeX = 0.5,
    relativeY = 0.5,
    ...clickOptions
  } = options;
  assertFiniteNumber(relativeX, 'relativeX');
  assertFiniteNumber(relativeY, 'relativeY');
  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) {
    throw new RangeError('relative coordinates must be between zero and one');
  }
  const initial = await getNamedTargetGeometry(page, targetName, { attribute });
  await sendPage(page, 'DOM.scrollIntoViewIfNeeded', { nodeId: initial.nodeId });
  const geometry = await getNamedTargetGeometry(page, targetName, { attribute });
  const x = geometry.viewport.x + geometry.viewport.width * relativeX;
  const y = geometry.viewport.y + geometry.viewport.height * relativeY;
  await clickAt(page, { x, y }, clickOptions);
  return { x, y, geometry };
}
