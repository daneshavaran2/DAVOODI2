// سرور نباید با یک درخواست بدساخت از کار بیفتد.
import test from 'node:test';
import assert from 'node:assert/strict';
import http, { request as httpRequest } from 'node:http';
import net from 'node:net';
import { instrument, server, servicePorts } from '../server.js';

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

// داده‌ای خام می‌فرستد و پاسخ خام را برمی‌گرداند
function rawSend(port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.end(data));
    let out = '';
    sock.on('data', (c) => (out += c));
    sock.on('close', () => resolve(out));
    sock.on('error', reject);
  });
}

test('عیب‌یابی اتصال: اتصال‌ها و درخواست‌های نامعتبر (مثلاً HTTPS یا PROXY protocol) در لاگ می‌آیند', async (t) => {
  const lines = [];
  const srv = instrument(http.createServer((req, res) => res.end('ok')), (l) => lines.push(l));
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  const { port } = srv.address();

  // دست‌دادن TLS به جای HTTP ساده
  const tls = await rawSend(port, Buffer.from([0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0xfc, 0x03, 0x03]));
  assert.match(tls, /^HTTP\/1\.1 400 Bad Request/);
  // PROXY protocol پیش از درخواست
  const proxy = await rawSend(port, 'PROXY TCP4 10.0.0.1 10.0.0.2 5555 3000\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n');
  assert.match(proxy, /^HTTP\/1\.1 400 Bad Request/);
  // درخواست درست همچنان کار می‌کند
  assert.match(await rawSend(port, 'GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /^HTTP\/1\.1 200 OK/);

  assert.equal(lines.filter((l) => l.startsWith('اتصال رسید: پورت')).length, 3);
  const bad = lines.filter((l) => l.startsWith('درخواست نامعتبر'));
  assert.equal(bad.length, 2);
  assert.match(bad[0], /آغاز داده: "\\u0016\\u0003\\u0001/);
  assert.match(bad[1], /آغاز داده: "PROXY TCP4 10\.0\.0\.1/);
});

test('پورت سرویس سکو از متغیرهای محیطی Kubernetes خوانده می‌شود و چیز دیگری ثبت نمی‌شود', () => {
  const env = {
    GHEYMAT_KHODRO_SERVICE_PORT: '80',
    GHEYMAT_KHODRO_SERVICE_PORT_HTTP: '3000',
    GHEYMAT_KHODRO_SERVICE_HOST: '10.0.0.7',
    KUBERNETES_SERVICE_PORT: '443',
    SECRET_SERVICE_PORT: 'abc',
    API_TOKEN: '12345',
  };
  assert.deepEqual(servicePorts(env), ['GHEYMAT_KHODRO_SERVICE_PORT=80', 'GHEYMAT_KHODRO_SERVICE_PORT_HTTP=3000']);
  assert.deepEqual(servicePorts({}), []);
});

// درخواست GET با سرآیند دلخواه ← { status, headers, body }
function getRaw(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('کش: صفحه اسکریپت و استایل نسخه‌دار دارد؛ هر بار با سرور چک می‌شوند (ETag و ۳۰۴)', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const page = await getRaw(port, '/');
  const m = page.body.match(/src="\/app\.js\?v=([\w-]+)"/);
  assert.ok(m, 'نشانی app.js نسخه دارد');
  assert.match(page.body, /href="\/style\.css\?v=[\w-]+"/);
  assert.equal(page.headers['cache-control'], 'no-cache');

  const js = await getRaw(port, `/app.js?v=${m[1]}`);
  assert.equal(js.status, 200);
  assert.equal(js.headers['cache-control'], 'no-cache');
  assert.ok(js.headers.etag);
  const again = await getRaw(port, '/app.js', { 'If-None-Match': js.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body, '');
  assert.equal((await getRaw(port, '/fonts/Vazirmatn-Variable.woff2')).headers['cache-control'], 'public, max-age=31536000, immutable');
});
