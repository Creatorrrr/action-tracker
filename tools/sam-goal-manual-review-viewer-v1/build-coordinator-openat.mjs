#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(directory, 'coordinator-openat.c');
const output = path.resolve(process.argv[2] ?? path.join(directory, 'coordinator-openat.node'));
const temporary = path.join(directory, '.coordinator-openat.node.unsigned');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const run = (executable, args) => {
  const result = spawnSync(executable, args, { cwd: directory, env: {}, encoding: 'utf8' });
  if (result.status !== 0 || result.signal !== null) fail(`${path.basename(executable)}_failed:${result.stderr.trim()}`);
};

function setDeterministicUuid(bytes, uuidBytes) {
  if (bytes.readUInt32LE(0) !== 0xfeedfacf) fail('macho_arm64_header_invalid');
  const commandCount = bytes.readUInt32LE(16); const commandBytes = bytes.readUInt32LE(20); let offset = 32; let found = 0;
  for (let index = 0; index < commandCount; index += 1) {
    if (offset + 8 > bytes.length) fail('macho_load_commands_invalid'); const command = bytes.readUInt32LE(offset); const size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > bytes.length || offset + size > 32 + commandBytes) fail('macho_load_commands_invalid');
    if (command === 0x1b) { if (size !== 24) fail('macho_uuid_command_invalid'); uuidBytes.copy(bytes, offset + 8); found += 1; }
    offset += size;
  }
  if (found !== 1 || offset !== 32 + commandBytes) fail('macho_uuid_command_invalid');
}

if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.argv.length > 3) fail('coordinator_openat_build_platform_invalid');
const clangLookup = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--find', 'clang'], { env: {}, encoding: 'utf8' }); if (clangLookup.status !== 0 || clangLookup.signal !== null) fail('xcrun_clang_lookup_failed'); const clang = clangLookup.stdout.trim();
const sdkLookup = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { env: {}, encoding: 'utf8' }); if (sdkLookup.status !== 0 || sdkLookup.signal !== null) fail('xcrun_sdk_lookup_failed'); const sdkPath = sdkLookup.stdout.trim(); const sdkSettings = path.join(sdkPath, 'SDKSettings.json');
const sourceBytes = fs.readFileSync(source); const sourceSha256 = sha256(sourceBytes); fs.rmSync(temporary, { force: true });
try {
  const buildArgv = ['--sdk', 'macosx', 'clang', '-bundle', '-undefined', 'dynamic_lookup', '-O2', '-Wall', '-Wextra', '-Werror', '-Wl,-no_adhoc_codesign', '-o', temporary, source]; run('/usr/bin/xcrun', buildArgv);
  const binary = fs.readFileSync(temporary); setDeterministicUuid(binary, Buffer.from(sourceSha256.slice(0, 32), 'hex')); fs.writeFileSync(temporary, binary, { mode: 0o755 });
  run('/usr/bin/codesign', ['--force', '--sign', '-', temporary]); run('/usr/bin/codesign', ['--verify', '--strict', temporary]); fs.renameSync(temporary, output);
  const codesignVersionResult = spawnSync('/usr/bin/what', ['/usr/bin/codesign'], { env: {}, encoding: 'utf8' }); const codesignVersion = /PROJECT:codesign-([^\s]+)/u.exec(codesignVersionResult.stdout)?.[1]; if (codesignVersionResult.status !== 0 || codesignVersionResult.signal !== null || !codesignVersion) fail('codesign_version_failed');
  process.stdout.write(`${JSON.stringify({ status: 'coordinator_openat_built', sourceSha256, binarySha256: sha256(fs.readFileSync(output)), buildExecutable: '/usr/bin/xcrun', buildArgv, xcrunByteSha256: sha256(fs.readFileSync('/usr/bin/xcrun')), clangPath: clang, clangByteSha256: sha256(fs.readFileSync(clang)), sdkPath, sdkSettingsByteSha256: sha256(fs.readFileSync(sdkSettings)), signingExecutable: '/usr/bin/codesign', signingArgv: ['--force', '--sign', '-', temporary], codesignByteSha256: sha256(fs.readFileSync('/usr/bin/codesign')), codesignVersion, nodeByteSha256: sha256(fs.readFileSync(process.execPath)) })}\n`);
} finally { fs.rmSync(temporary, { force: true }); }
