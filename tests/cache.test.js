const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('../lib/cache');

const tmpFile = path.join(os.tmpdir(), `cache-test-${process.pid}.json`);

test('read returns null when file does not exist', () => {
  const result = cache.read('/tmp/nonexistent-cache-file-99999.json');
  assert.strictEqual(result, null);
});

test('write creates file and read returns the same data', () => {
  const data = { fetchedAt: 1719446400000, videos: [{ hashedId: 'abc' }] };
  cache.write(tmpFile, data);
  const result = cache.read(tmpFile);
  assert.deepStrictEqual(result, data);
  fs.unlinkSync(tmpFile);
});

test('read returns null when file contains invalid JSON', () => {
  fs.writeFileSync(tmpFile, 'not valid json { ]', 'utf8');
  const result = cache.read(tmpFile);
  assert.strictEqual(result, null);
  fs.unlinkSync(tmpFile);
});
