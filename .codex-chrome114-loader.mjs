import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = path.join(
  ROOT,
  'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-chrome-cdp-v1.mjs',
);
const HELPER_URL = pathToFileURL(HELPER_PATH).href;
const HELPER_SHA256 = '0642c093d5839c1cc5ea5ec9055c8416a24306979b43fc10bd5e68917e2e3cec';
const MAIN_TEST_PATH = path.join(ROOT, 'tests/sam-goal-manual-review-ops-v1-check.mjs');
const MAIN_TEST_URL = pathToFileURL(MAIN_TEST_PATH).href;
const MAIN_TEST_SHA256 = '93cee70b03bcf5d6d872a02c77405eb025e8a2572ea5260853f118b84f6df30b';
const CHROME_BINARY = '/private/tmp/chrome-150-0-7871-114-SASlw3/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_BINARY_SHA256 = '2fb14e35e0cf70ea24fa91402ca3676459255bd6e13e331a8893be203cdb7d54';
const ORIGINAL_DECLARATION =
  "export const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';";
const OVERRIDE_DECLARATION = `export const CHROME_BINARY = ${JSON.stringify(CHROME_BINARY)};`;
const EVALUATE_SEND = `  const response = await sendPage(page, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue,
    userGesture,
  }, timeoutMs);`;
const DIAGNOSTIC_EVALUATE_SEND = `  let response;
  try {
    response = await sendPage(page, 'Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      userGesture,
    }, timeoutMs);
  } catch (error) {
    const expressionPrefix = expression.replace(/\\s+/gu, ' ').slice(0, 320);
    const diagnostic = { timeoutMs, expressionLength: expression.length, expressionPrefix };
    process.stderr.write(\`[chrome114-loader:Runtime.evaluate-failure] \${JSON.stringify(diagnostic)}\\n\`);
    error.message = \`\${error.message}; diagnostic=\${JSON.stringify(diagnostic)}\`;
    throw error;
  }`;
const MAIN_CLEANUP = 'if (tempRoot && pathExists(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });';
const DIAGNOSTIC_MAIN_CLEANUP = `if (tempRoot && pathExists(tempRoot)) { if (process.env.SAM_CDP_DIAG_PRESERVE_TEMP === '1') process.stderr.write(\`[chrome114-loader:preserve-temp] \${tempRoot}\\n\`); else rmSync(tempRoot, { recursive: true, force: true }); }`;
let interceptionCount = 0;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function occurrenceCount(source, needle) {
  return source.split(needle).length - 1;
}

assert.equal(existsSync(CHROME_BINARY), true, `recovered Chrome binary is missing: ${CHROME_BINARY}`);
assert.equal(
  sha256(readFileSync(CHROME_BINARY)),
  CHROME_BINARY_SHA256,
  'recovered Chrome binary SHA-256 drift',
);

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (url === MAIN_TEST_URL && process.env.SAM_CDP_DIAG_PRESERVE_TEMP === '1') {
    assert.equal(loaded.format, 'module', 'manual review operations test must load as an ESM module');
    const originalBytes = Buffer.from(loaded.source);
    const originalSource = originalBytes.toString('utf8');
    assert.equal(sha256(originalBytes), MAIN_TEST_SHA256, 'manual review operations test SHA-256 drift');
    assert.equal(occurrenceCount(originalSource, MAIN_CLEANUP), 2, 'temp cleanup must occur exactly twice');
    const transformedSource = originalSource.replaceAll(MAIN_CLEANUP, DIAGNOSTIC_MAIN_CLEANUP);
    assert.equal(occurrenceCount(transformedSource, DIAGNOSTIC_MAIN_CLEANUP), 2, 'diagnostic temp preservation must occur exactly twice');
    const inverseNormalized = transformedSource.replaceAll(DIAGNOSTIC_MAIN_CLEANUP, MAIN_CLEANUP);
    assert.equal(sha256(Buffer.from(inverseNormalized)), MAIN_TEST_SHA256, 'inverse-normalized main test is not byte-exact');
    process.stderr.write(`[chrome114-loader] diagnostic temp preservation applied; original=${MAIN_TEST_SHA256} transformed=${sha256(Buffer.from(transformedSource))}\n`);
    return { ...loaded, source: transformedSource };
  }
  if (url !== HELPER_URL) return loaded;
  interceptionCount += 1;
  assert.equal(interceptionCount, 1, 'headed Chrome CDP helper must be intercepted exactly once');

  assert.equal(loaded.format, 'module', 'headed Chrome CDP helper must load as an ESM module');
  const originalBytes = Buffer.from(loaded.source);
  const originalSource = originalBytes.toString('utf8');
  assert.equal(sha256(originalBytes), HELPER_SHA256, 'headed Chrome CDP helper SHA-256 drift');
  assert.equal(
    occurrenceCount(originalSource, ORIGINAL_DECLARATION),
    1,
    'headed Chrome CDP helper Chrome path declaration must occur exactly once',
  );

  let transformedSource = originalSource.replace(ORIGINAL_DECLARATION, OVERRIDE_DECLARATION);
  assert.equal(
    occurrenceCount(transformedSource, OVERRIDE_DECLARATION),
    1,
    'headed Chrome CDP helper override must occur exactly once',
  );
  if (process.env.SAM_CDP_DIAG === '1') {
    assert.equal(occurrenceCount(transformedSource, EVALUATE_SEND), 1, 'Runtime.evaluate send block must occur exactly once');
    transformedSource = transformedSource.replace(EVALUATE_SEND, DIAGNOSTIC_EVALUATE_SEND);
    assert.equal(occurrenceCount(transformedSource, DIAGNOSTIC_EVALUATE_SEND), 1, 'diagnostic Runtime.evaluate block must occur exactly once');
  }
  let inverseNormalized = transformedSource;
  if (process.env.SAM_CDP_DIAG === '1') {
    inverseNormalized = inverseNormalized.replace(DIAGNOSTIC_EVALUATE_SEND, EVALUATE_SEND);
  }
  inverseNormalized = inverseNormalized.replace(OVERRIDE_DECLARATION, ORIGINAL_DECLARATION);
  assert.equal(
    sha256(Buffer.from(inverseNormalized)),
    HELPER_SHA256,
    'inverse-normalized headed Chrome CDP helper is not byte-exact',
  );
  process.stderr.write(
    `[chrome114-loader] exact-one helper path override applied; interceptCount=${interceptionCount} diagnostic=${process.env.SAM_CDP_DIAG === '1'} original=${HELPER_SHA256} transformed=${sha256(Buffer.from(transformedSource))} binary=${CHROME_BINARY_SHA256}\n`,
  );
  return { ...loaded, source: transformedSource };
}
