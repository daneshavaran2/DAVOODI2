// سرور نباید با یک درخواست بدساخت از کار بیفتد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { server } from '../server.js';

function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('نشانی با کدگذاری نادرست («/%FF») خطای ۴۰۰ می‌دهد و سرور زنده می‌ماند', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  assert.equal(await rawGet(port, '/%FF'), 400);
  assert.equal(await rawGet(port, '/%E0%A4%A'), 400);
  assert.equal(await rawGet(port, '/api/health'), 200);
  assert.equal(await rawGet(port, '/'), 200);
});
