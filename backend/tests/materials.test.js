import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';

import { safeMaterialPath, serveMaterialRequest } from '../src/materials.js';

class TestResponse extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.headers = null;
    this.statusCode = null;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks);
  }
}

async function createMaterialFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'materials-test-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'report.pdf'), '0123456789');
  return root;
}

test('safeMaterialPath confines paths to the materials root', () => {
  assert.equal(safeMaterialPath('/materials/project/report.pdf'), 'project/report.pdf');
  assert.throws(() => safeMaterialPath('/materials/%2e%2e/outside.pdf'), /path escapes the corpus/);
});

test('serveMaterialRequest serves a full response', async () => {
  const root = await createMaterialFixture();
  try {
    const full = new TestResponse();
    await serveMaterialRequest(
      full,
      '/materials/project/report.pdf',
      { root },
    );
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers['Content-Type'], 'application/pdf');
    assert.equal(full.body.toString(), '0123456789');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('serveMaterialRequest returns generic errors for invalid paths', async () => {
  const root = await createMaterialFixture();
  try {
    const traversal = new TestResponse();
    await serveMaterialRequest(
      traversal,
      '/materials/%2e%2e/outside.pdf',
      { root },
    );
    assert.equal(traversal.statusCode, 404);
    assert.deepEqual(JSON.parse(traversal.body.toString()), { error: 'material not found' });

    const missing = new TestResponse();
    await serveMaterialRequest(
      missing,
      '/materials/project/missing.pdf',
      { root },
    );
    assert.equal(missing.statusCode, 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
