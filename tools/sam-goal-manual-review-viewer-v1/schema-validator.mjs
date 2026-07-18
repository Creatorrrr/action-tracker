import fs from 'node:fs';
import path from 'node:path';

const rawCompare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort(rawCompare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

export class SchemaValidationError extends Error {
  constructor(instancePath, schemaPath, keyword) { super(`schema_validation_failed:${instancePath}:${schemaPath}:${keyword}`); this.code = 'process_schema_validation_failed'; this.instancePath = instancePath; this.schemaPath = schemaPath; this.keyword = keyword; }
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
function pointer(root, fragment) {
  if (!fragment || fragment === '#') return root; if (!fragment.startsWith('#/')) throw new Error('schema_ref_fragment_invalid');
  return fragment.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, key) => value[key], root);
}

export class ClosedDraft202012Validator {
  constructor(schemaFiles) {
    this.schemas = new Map(); this.ids = new Map();
    for (const file of schemaFiles) { const absolute = path.resolve(file); const schema = JSON.parse(fs.readFileSync(absolute, 'utf8')); this.schemas.set(absolute, schema); if (typeof schema.$id === 'string') this.ids.set(schema.$id, absolute); }
  }
  validate(schemaFile, value) { const absolute = path.resolve(schemaFile); const schema = this.schemas.get(absolute); if (!schema) throw new Error('schema_not_registered'); this.#walk(schema, value, absolute, '#', '#'); return true; }
  #resolve(ref, currentFile) {
    const hash = ref.indexOf('#'); const filePart = hash >= 0 ? ref.slice(0, hash) : ref; const fragment = hash >= 0 ? ref.slice(hash) : '#';
    const file = !filePart ? currentFile : /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(filePart) ? this.ids.get(filePart) : path.resolve(path.dirname(currentFile), filePart);
    const root = this.schemas.get(file); if (!root) throw new Error(`schema_ref_unregistered:${filePart}`); return { schema: pointer(root, fragment), file, fragment };
  }
  #walk(schema, value, currentFile, instancePath, schemaPath) {
    const reject = (keyword) => { throw new SchemaValidationError(instancePath, schemaPath, keyword); };
    if (schema === true) return; if (schema === false) reject('falseSchema');
    if (schema.$ref) { const resolved = this.#resolve(schema.$ref, currentFile); this.#walk(resolved.schema, value, resolved.file, instancePath, `${resolved.file}${resolved.fragment}`); }
    if (schema.allOf) for (let index = 0; index < schema.allOf.length; index += 1) this.#walk(schema.allOf[index], value, currentFile, instancePath, `${schemaPath}/allOf/${index}`);
    if (schema.anyOf) { let pass = 0; for (let index = 0; index < schema.anyOf.length; index += 1) try { this.#walk(schema.anyOf[index], value, currentFile, instancePath, `${schemaPath}/anyOf/${index}`); pass += 1; } catch (error) { if (!(error instanceof SchemaValidationError)) throw error; } if (!pass) reject('anyOf'); }
    if (schema.oneOf) { let pass = 0; for (let index = 0; index < schema.oneOf.length; index += 1) try { this.#walk(schema.oneOf[index], value, currentFile, instancePath, `${schemaPath}/oneOf/${index}`); pass += 1; } catch (error) { if (!(error instanceof SchemaValidationError)) throw error; } if (pass !== 1) reject('oneOf'); }
    if (schema.not) { let passed = false; try { this.#walk(schema.not, value, currentFile, instancePath, `${schemaPath}/not`); passed = true; } catch (error) { if (!(error instanceof SchemaValidationError)) throw error; } if (passed) reject('not'); }
    if (Object.hasOwn(schema, 'const') && canonical(value) !== canonical(schema.const)) reject('const');
    if (schema.enum && !schema.enum.some((candidate) => canonical(candidate) === canonical(value))) reject('enum');
    if (schema.type) { const types = Array.isArray(schema.type) ? schema.type : [schema.type]; if (!types.some((type) => typeMatches(value, type))) reject('type'); }
    if (typeof value === 'string') { if (schema.minLength !== undefined && [...value].length < schema.minLength) reject('minLength'); if (schema.maxLength !== undefined && [...value].length > schema.maxLength) reject('maxLength'); if (schema.pattern !== undefined && !(new RegExp(schema.pattern, 'u')).test(value)) reject('pattern'); }
    if (typeof value === 'number') { if (!Number.isFinite(value)) reject('finite'); if (schema.minimum !== undefined && value < schema.minimum) reject('minimum'); if (schema.maximum !== undefined && value > schema.maximum) reject('maximum'); }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) reject('minItems'); if (schema.maxItems !== undefined && value.length > schema.maxItems) reject('maxItems');
      if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) reject('uniqueItems');
      if (schema.items) for (let index = 0; index < value.length; index += 1) this.#walk(schema.items, value[index], currentFile, `${instancePath}/${index}`, `${schemaPath}/items`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (schema.required) for (const key of schema.required) if (!Object.hasOwn(value, key)) reject(`required:${key}`);
      if (schema.properties) for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key)) this.#walk(child, value[key], currentFile, `${instancePath}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, `${schemaPath}/properties/${key}`);
      if (schema.additionalProperties === false) { const known = new Set(Object.keys(schema.properties ?? {})); for (const key of Object.keys(value)) if (!known.has(key)) reject(`additionalProperties:${key}`); }
    }
  }
}

export function createProcessSchemaValidator(schemaDirectory, authoringSchemaPath) {
  const names = fs.readdirSync(schemaDirectory).filter((name) => name.endsWith('.schema.json')).sort(rawCompare);
  const expected = ['access-evidence-v1.schema.json','bundle-manifest-v1.schema.json','c0-ledger-v1.schema.json','deviation-evidence-v1.schema.json','edit-journal-v1.schema.json','handoff-report-v1.schema.json','raw-ab-report-v1.schema.json','reveal-receipt-v1.schema.json','review-export-receipt-v1.schema.json','worksheet-v1.schema.json'].sort(rawCompare);
  if (canonical(names) !== canonical(expected)) throw new Error('process_schema_set_invalid');
  return new ClosedDraft202012Validator([...names.map((name) => path.join(schemaDirectory, name)), authoringSchemaPath]);
}
