/* global __dirname, Buffer, URLSearchParams */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const from = name => createRequire(require.resolve(name));

test('bcrypt 6 verifies a bcrypt 5 persisted hash and rejects an incorrect password', async () => {
  const fixture = require(path.join(root, 'docs/security/bcrypt5-compatibility-fixture.json'));
  const bcrypt = require('bcrypt');
  assert.equal(await bcrypt.compare(fixture.password, fixture.hash), true);
  assert.equal(await bcrypt.compare('incorrect-password', fixture.hash), false);
  assert.equal(await bcrypt.compare(fixture.password, await bcrypt.hash(fixture.password, 10)), true);
  assert.equal(Object.keys(require.cache).some(p => /node_modules[/\\]tar[/\\]/.test(p)), false);
});

test('real Nest FileInterceptor accepts uploads and rejects oversized or unexpected files', async () => {
  const express = require('express');
  const request = require('supertest');
  const { FileInterceptor } = require('@nestjs/platform-express');
  const { of, lastValueFrom } = require('rxjs');
  const Interceptor = FileInterceptor('file', { limits: { fileSize: 16 } });
  const app = express();
  app.post('/upload', async (req, res) => {
    try {
      const stream = await new Interceptor().intercept({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) }, { handle: () => of({ size: req.file?.size, content: req.file?.buffer.toString() }) });
      res.json(await lastValueFrom(stream));
    } catch (error) { res.status(error.getStatus?.() ?? 500).json({ rejected: true }); }
  });
  const valid = await request(app).post('/upload').attach('file', Buffer.from('evidence'), 'evidence.txt');
  assert.equal(valid.status, 200);
  assert.deepEqual(valid.body, { size: 8, content: 'evidence' });
  assert.equal((await request(app).post('/upload').attach('file', Buffer.alloc(17), 'large.txt')).status, 413);
  assert.equal((await request(app).post('/upload').attach('unexpected', Buffer.from('x'), 'x.txt')).status, 400);
  const malformed = await request(app).post('/upload').set('Content-Type', 'multipart/form-data; boundary=opa').send('--opa\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\ntruncated');
  assert.equal(malformed.status, 400);
});

test('Swagger pinned YAML serializer preserves OpenAPI document', () => {
  const yaml = from('@nestjs/swagger')('js-yaml');
  const doc = { openapi: '3.0.0', info: { title: 'OPA Safety API', version: '1.0' }, paths: {} };
  assert.deepEqual(yaml.load(yaml.dump(doc)), doc);
});

test('Nest lodash configuration merge remains compatible', () => {
  for (const parent of ['@nestjs/config', '@nestjs/swagger']) {
    const lodash = from(parent)('lodash');
    assert.deepEqual(lodash.merge({}, { security: { required: true } }, { security: { enabled: true } }), { security: { required: true, enabled: true } });
  }
});

test('Prisma deepmerge override handles config records and recursive input', () => {
  const { deepmerge } = from('@prisma/config')('deepmerge-ts');
  assert.deepEqual(deepmerge({ migrations: { path: 'prisma/migrations' } }, { schema: 'prisma/schema.prisma' }), { migrations: { path: 'prisma/migrations' }, schema: 'prisma/schema.prisma' });
  const value = {}; value.self = value;
  assert.doesNotThrow(() => deepmerge(value, value));
});

test('build-tool glob and picomatch APIs used by parents remain available', async () => {
  const glob = createRequire(require.resolve('@nestjs/cli/package.json'))('glob');
  assert.ok((await glob.glob('apps/api/package.json', { cwd: root })).length === 1);
  const match = from('@angular-devkit/core')('picomatch');
  assert.equal(match('**/*.ts')('src/main.ts'), true);
});

test('external-editor temporary filename API remains compatible', () => {
  const tmp = from('external-editor')('tmp');
  const name = tmp.tmpNameSync({ prefix: 'opa-dependency-' });
  assert.equal(typeof name, 'string');
  assert.equal(fs.existsSync(name), false);
});

test('real Africa Talking SDK preserves SMS form and response contract without network', async () => {
  const axios = from('africastalking')('axios');
  const original = axios.defaults.adapter;
  let sent;
  const response = { SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'fixture' }] } };
  axios.defaults.adapter = async config => {
    sent = config;
    return { status: 201, statusText: 'Created', data: response, headers: {}, config };
  };
  try {
    const sms = require('africastalking')({ apiKey: 'public-test-key', username: 'sandbox' }).SMS;
    assert.deepEqual(await sms.send({ to: ['+2348031234567'], message: 'public test fixture', from: 'OPA' }), response);
    const form = new URLSearchParams(sent.data);
    assert.equal(form.get('to'), '+2348031234567');
    assert.equal(form.get('message'), 'public test fixture');
    assert.equal(form.get('from'), 'OPA');
    assert.ok(sent.url.startsWith('https://'));
    await assert.rejects(sms.send({ to: ['invalid'], message: 'fixture' }));
  } finally { axios.defaults.adapter = original; }
});

test('updated Nest file validator accepts PNG and rejects unknown bytes', async () => {
  const { FileTypeValidator } = require('@nestjs/common');
  const validator = new FileTypeValidator({ fileType: 'image/png' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  assert.equal(await validator.isValid({ mimetype: 'image/png', buffer: png }), true);
  assert.equal(await validator.isValid({ mimetype: 'image/png', buffer: Buffer.from('not an image') }), false);
});

test('Express JSON and form parsers preserve input and enforce size limits', async () => {
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use(express.json({ limit: 64 }), express.urlencoded({ extended: true, limit: 64 }));
  app.post('/', (req, res) => res.json(req.body));
  app.use((error, req, res, next) => { void req; void next; res.status(error.status || 500).end(); });
  assert.deepEqual((await request(app).post('/').send({ safe: 'value' })).body, { safe: 'value' });
  assert.deepEqual((await request(app).post('/').type('form').send('safe[value]=ok')).body, { safe: { value: 'ok' } });
  assert.equal((await request(app).post('/').send({ value: 'x'.repeat(80) })).status, 413);
});

test('Angular devkit AJV schema API validates and rejects invalid values', () => {
  const Ajv = from('@angular-devkit/core')('ajv');
  const validate = new Ajv({ $data: true }).compile({ type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false });
  assert.equal(validate({ enabled: true }), true);
  assert.equal(validate({ enabled: 'yes' }), false);
});

test('Nest webpack can compile a local fixture with its updated compiler', async () => {
  const webpack = createRequire(require.resolve('@nestjs/cli/package.json'))('webpack');
  const os = require('node:os');
  const base = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'opa-dependency-webpack-'));
  assert.ok(path.resolve(directory).startsWith(base + path.sep));
  const entry = path.join(directory, 'entry.cjs');
  fs.writeFileSync(entry, 'module.exports = 42;\n');
  const compiler = webpack({ mode: 'production', target: 'node', entry, output: { path: path.join(directory, 'out'), filename: 'bundle.cjs' } });
  try {
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    if (path.resolve(directory).startsWith(base + path.sep + 'opa-dependency-webpack-')) fs.rmSync(directory, { recursive: true, force: true });
  }
});
