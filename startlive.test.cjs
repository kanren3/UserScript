'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { TextEncoder, TextDecoder } = require('node:util');

const SALT = 'af125a0d5279fd576c1b4418a3e8276d';
const BUVID_KEY = 'bili_native_buvid';
const BUVID_SOURCE_KEY = 'bili_native_buvid_source';
const CACHED_BUVID = 'test-native-device!~';
const API_URL = 'https://api.live.bilibili.com/test';
const UUID = '12345678-1234-4abc-8abc-123456789abc';
const source = readFileSync(join(__dirname, 'BilibiliStreamKeyHelper.user.js'), 'utf8');
const startup = source.lastIndexOf('\n  // 页面导航事件监听');
if (startup < 0) throw new Error('Cannot locate userscript DOM startup boundary');
// Export the real closure functions before DOM startup; production code is unchanged.
const instrumented = source.slice(0, startup) + `
  globalThis.__protocol = {
    serializeParams, signParams, md5Ascii, commonParams,
    buildStartLiveBody, buildStopLiveBody, ensureBuvid,
    getApiHeaders, gmRequest, requestJson, signedRequest,
    startLive, stopLive, selectStream,
    getLiveState: () => ({ isLiveStarted, liveStatusUnknown, liveOperationPending })
  };
  return;
` + source.slice(startup);
const script = new vm.Script(instrumented, { filename: 'BilibiliStreamKeyHelper.user.js' });

function loadProtocol({ storage = {}, replies = [], now = 1700000000000, nodes = {} } = {}) {
  const values = new Map(Object.entries(storage));
  const messages = [];
  const writes = [];
  const requests = [];
  const remainingReplies = [...replies];
  let randomCalls = 0;
  let time = now;
  class FixtureDate extends Date {
    static now() { return time; }
  }
  const sandbox = {
    console, URL, URLSearchParams, TextEncoder, TextDecoder, Date: FixtureDate,
    document: {
      cookie: 'buvid3=COOKIE_DEVICE_MUST_NOT_BE_USED; bili_jct=COOKIE_CSRF',
      getElementById(id) { return nodes[id] || null; },
    },
    GM_notification({ text }) { messages.push(text); },
    confirm() { return true; },
    setTimeout, clearTimeout,
    crypto: {
      randomUUID() { randomCalls += 1; return UUID; },
      getRandomValues(array) {
        randomCalls += 1;
        for (let index = 0; index < array.length; index += 1) array[index] = index * 17 % 256;
        return array;
      },
    },
    GM_getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    GM_setValue(key, value) { values.set(key, value); writes.push([key, value]); },
    GM_deleteValue(key) { values.delete(key); },
    GM_xmlhttpRequest(options) {
      requests.push(options);
      if (remainingReplies.length === 0) throw new Error(`Unexpected request: ${options.url}`);
      const reply = remainingReplies.shift();
      if (!reply.defer) {
        queueMicrotask(() => {
          const { event = 'load', ...payload } = reply;
          options[`on${event}`](payload);
        });
      }
      return { abort() { options.onabort({}); } };
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  script.runInContext(context);
  return {
    api: context.__protocol, values, writes, requests, messages,
    randomCalls: () => randomCalls,
    setTime(value) { time = value; },
  };
}

function md5(text) {
  return createHash('md5').update(text, 'ascii').digest('hex');
}

// Independent byte-wise oracle: neither production serializer nor encodeURIComponent.
function percentEncode(text) {
  const safe = Buffer.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!'()*-._~");
  return [...Buffer.from(text, 'utf8')].map(byte => safe.includes(byte)
    ? String.fromCharCode(byte)
    : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
}

function referenceSerialize(params) {
  return Object.keys(params)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`).join('&');
}

function referenceSign(params) { return md5(referenceSerialize(params) + SALT); }
function parseBody(body) { return Object.fromEntries(new URLSearchParams(body)); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function headersOf(request) {
  return Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
}
function ok(data = { value: 'ok' }) { return { status: 200, responseText: JSON.stringify({ code: 0, data }) }; }
function withDevice(replies) { return loadProtocol({ storage: { [BUVID_KEY]: CACHED_BUVID }, replies }); }
function errorKind(kind, inspect = () => {}) {
  return error => {
    assert.equal(Object.prototype.toString.call(error), '[object Error]');
    assert.equal(error.kind, kind);
    inspect(error);
    return true;
  };
}

const landscapeParams = {
  appkey: 'aae92bc66f3edfab', platform: 'pc_link', version: '8.8.0.11119',
  build: '11119', ts: '1700000000', access_key: '', room_id: '123',
  area_v2: '456', type: '2', csrf: 'EXAMPLE_CSRF', csrf_token: 'EXAMPLE_CSRF',
};
const landscapeBody = 'access_key=&appkey=aae92bc66f3edfab&area_v2=456&build=11119&csrf=EXAMPLE_CSRF&csrf_token=EXAMPLE_CSRF&platform=pc_link&room_id=123&sign=c187040363c754fbfb428dc1017c4261&ts=1700000000&type=2&version=8.8.0.11119';

for (const [orientation, digest] of [
  ['landscape', 'c187040363c754fbfb428dc1017c4261'],
  ['portrait', 'a8948ab4de10b3f70a6898554fea8fce'],
]) {
  test(`startLive reproduces documented ${orientation} full wire vector`, () => {
    const { api } = loadProtocol();
    const params = { ...landscapeParams, type: orientation === 'portrait' ? '1' : '2' };
    const expected = orientation === 'landscape' ? landscapeBody
      : landscapeBody.replace('c187040363c754fbfb428dc1017c4261', digest).replace('&type=2&', '&type=1&');
    assert.equal(referenceSign(params), digest);
    assert.equal(api.signParams(params), digest);
    assert.equal(api.buildStartLiveBody('123', '456', 'EXAMPLE_CSRF', orientation, '1700000000'), expected);
  });
}

test('generic signing reproduces src=7 / checked=0 vector without mutating input', () => {
  const { api } = loadProtocol();
  const params = Object.freeze({ ...landscapeParams, src: '7', checked: '0' });
  const before = { ...params };
  assert.equal(api.signParams(params), '91624da5b22e66c1e8471aeadcd0bcd6');
  assert.equal(api.signParams(params), referenceSign(params));
  assert.deepEqual(params, before);
  assert.equal(api.serializeParams(params), referenceSerialize(params));
});

test('empty signing input retains documented salt-only digest and empty values are significant', () => {
  const { api } = loadProtocol();
  assert.equal(api.serializeParams({}), '');
  assert.equal(api.signParams({}), 'b4128d99822aa96e502be595c55baa93');
  assert.equal(api.serializeParams({ empty: '' }), 'empty=');
  assert.equal(api.signParams({ empty: '' }), referenceSign({ empty: '' }));
  assert.notEqual(api.signParams({}), api.signParams({ empty: '' }));
});

test('percent encoding preserves only specified safe bytes and does not predecode', () => {
  const { api } = loadProtocol();
  const params = { 'key +&=': " !'()*-._~+%&=/中%2F", empty: '' };
  assert.equal(api.serializeParams(params), "empty=&key%20%2B%26%3D=%20!'()*-._~%2B%25%26%3D%2F%E4%B8%AD%252F");
  assert.equal(api.signParams(params), referenceSign(params));
});

test('key ordering uses raw UTF-8 bytes, including supplementary Unicode', () => {
  const { api } = loadProtocol();
  const params = { '\u{10000}': 'supplementary', '\uE000': 'bmp', 'é': 'accent', z: '', A: 'first' };
  assert.equal(api.serializeParams(params), 'A=first&z=&%C3%A9=accent&%EE%80%80=bmp&%F0%90%80%80=supplementary');
  assert.equal(api.signParams(params), referenceSign(params));
});

test('Unicode values retain exact UTF-8 and normalization distinctions', () => {
  const { api } = loadProtocol();
  for (const value of ['中', '😀', 'é', 'e\u0301', 'a\t\r\nb', 'token +%中文/😀']) {
    assert.equal(api.serializeParams({ value }), referenceSerialize({ value }));
    assert.equal(api.signParams({ value }), referenceSign({ value }));
  }
  assert.notEqual(api.signParams({ value: 'é' }), api.signParams({ value: 'e\u0301' }));
});

test('MD5 matches node:crypto across padding and multiple-block boundaries', () => {
  const { api } = loadProtocol();
  for (const length of [0, 1, 7, 31, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024, 4097]) {
    const text = Array.from({ length }, (_, index) => String.fromCharCode(33 + index % 94)).join('');
    assert.equal(api.md5Ascii(text), md5(text), `ASCII input length ${length}`);
  }
});

test('parameter containers must be string-to-string objects, not coercible primitives or arrays', () => {
  const { api } = loadProtocol();
  for (const params of [null, undefined, '', 'key=value', 42, false, [], [['key', 'value']]]) {
    assert.throws(() => api.serializeParams(params));
    assert.throws(() => api.signParams(params));
  }
});

for (const [label, params] of [
  ['empty key', { '': 'value' }],
  ['NUL key', { 'a\0b': 'value' }],
  ['NUL value', { key: 'a\0b' }],
  ['number', { key: 123 }],
  ['boolean', { key: false }],
  ['null', { key: null }],
  ['undefined', { key: undefined }],
  ['object', { key: {} }],
  ['array value', { key: ['string'] }],
]) {
  test(`serializer and signer reject ${label} instead of coercing or truncating`, () => {
    const { api } = loadProtocol();
    assert.throws(() => api.serializeParams(params));
    assert.throws(() => api.signParams(params));
  });
}

test('sign cannot participate in its own signature, including an empty sign', () => {
  const { api } = loadProtocol();
  for (const sign of ['', 'old-sign']) assert.throws(() => api.signParams({ ...landscapeParams, sign }));
});

test('start includes CSRF in signature while stop signs before appending CSRF', () => {
  const { api } = loadProtocol();
  const starts = [];
  const stops = [];
  for (const csrf of ['csrf-A', 'csrf B+%中']) {
    const start = parseBody(api.buildStartLiveBody('123', '456', csrf, 'landscape', '1700000000'));
    const stop = parseBody(api.buildStopLiveBody('123', csrf, '1700000000'));
    const { sign: startSign, ...startSigned } = start;
    const { sign: stopSign, csrf: stopCsrf, csrf_token: stopToken, ...stopSigned } = stop;
    assert.equal(startSign, referenceSign(startSigned));
    assert.equal(startSigned.csrf, csrf);
    assert.equal(startSigned.csrf_token, csrf);
    assert.equal(stopSign, referenceSign(stopSigned));
    assert.notEqual(stopSign, referenceSign({ ...stopSigned, csrf, csrf_token: csrf }));
    assert.equal(stopCsrf, csrf);
    assert.equal(stopToken, csrf);
    starts.push(startSign);
    stops.push(stopSign);
  }
  assert.notEqual(starts[0], starts[1]);
  assert.equal(stops[0], stops[1]);
});

test('builders reject invalid identifiers, timestamps, CSRF, and directions', () => {
  const { api } = loadProtocol();
  for (const invalid of ['', '0', '-1', '1.2', '1e3', '1,000', ' 123', '123 ', '123\n', '123\r\n', '01', 123, null]) {
    assert.throws(() => api.buildStartLiveBody(invalid, '456', 'csrf', 'landscape', '1700000000'));
    assert.throws(() => api.buildStartLiveBody('123', invalid, 'csrf', 'landscape', '1700000000'));
    assert.throws(() => api.buildStopLiveBody(invalid, 'csrf', '1700000000'));
    assert.throws(() => api.buildStartLiveBody('123', '456', 'csrf', 'landscape', invalid));
    assert.throws(() => api.buildStopLiveBody('123', 'csrf', invalid));
  }
  for (const invalid of ['', null, 123, 'a\0b']) {
    assert.throws(() => api.buildStartLiveBody('123', '456', invalid, 'landscape', '1700000000'));
    assert.throws(() => api.buildStopLiveBody('123', invalid, '1700000000'));
  }
  assert.throws(() => api.buildStartLiveBody('123', '456', 'csrf', 'sideways', '1700000000'));
});

test('valid cached native buvid is reused without network, randomness, or cookie substitution', async () => {
  const fixture = withDevice([]);
  assert.equal(await fixture.api.ensureBuvid(), CACHED_BUVID);
  assert.equal(await fixture.api.ensureBuvid(), CACHED_BUVID);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.randomCalls(), 0);
  assert.deepEqual(fixture.writes, []);
  assert.equal(headersOf({ headers: await fixture.api.getApiHeaders() }).buvid, CACHED_BUVID);
});

test('missing buvid fetches anonymous raw gv body once and persists exact identity', async () => {
  const identity = 'native!device~+%2F';
  const fixture = loadProtocol({ replies: [{ status: 200, responseText: identity }] });
  assert.equal(await fixture.api.ensureBuvid(), identity);
  assert.equal(await fixture.api.ensureBuvid(), identity);
  assert.equal(fixture.requests.length, 1);
  const request = fixture.requests[0];
  assert.equal(request.method, 'GET');
  assert.equal(request.url, 'https://data.bilibili.com/gv');
  assert.equal(request.anonymous, true);
  assert.equal(request.data, undefined);
  assert.equal(headersOf(request).cookie, undefined);
  assert.equal(headersOf(request).buvid, undefined);
  assert.equal(fixture.values.get(BUVID_KEY), identity);
  assert.equal(fixture.values.get(BUVID_SOURCE_KEY), 'remote-gv');
  assert.equal(fixture.randomCalls(), 0);
  const restarted = loadProtocol({ storage: Object.fromEntries(fixture.values) });
  assert.equal(await restarted.api.ensureBuvid(), identity);
  assert.equal(restarted.requests.length, 0);
});

for (const [label, reply] of [
  ['HTTP 404', { status: 404, responseText: 'not found' }],
  ['HTTP 503', { status: 503, responseText: 'unavailable' }],
  ['network error', { event: 'error', status: 0 }],
  ['timeout', { event: 'timeout' }],
]) {
  test(`buvid ${label} falls back to persistent UUIDv4 browser PID 0 identity`, async () => {
    const fixture = loadProtocol({ replies: [reply] });
    const identity = await fixture.api.ensureBuvid();
    assert.match(identity, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}0user$/);
    assert.equal(fixture.values.get(BUVID_KEY), identity);
    assert.equal(fixture.values.get(BUVID_SOURCE_KEY), 'local-uuid-v4-browser-pid-0');
    assert.ok(fixture.randomCalls() > 0);
    assert.equal(await fixture.api.ensureBuvid(), identity);
    assert.equal(fixture.requests.length, 1);
    const restarted = loadProtocol({ storage: Object.fromEntries(fixture.values) });
    assert.equal(await restarted.api.ensureBuvid(), identity);
    assert.equal(restarted.randomCalls(), 0);
  });
}

for (const [label, identity] of [
  ['empty', ''], ['leading space', ' device'], ['trailing newline', 'device\n'],
  ['embedded space', 'de vice'], ['NUL', 'de\0vice'], ['DEL', 'device\x7f'],
  ['non-ASCII', '设备'], ['oversized', 'x'.repeat(4097)],
]) {
  test(`gv ${label} body fails without trimming, persistence, or fallback`, async () => {
    const fixture = loadProtocol({ replies: [{ status: 200, responseText: identity }] });
    await assert.rejects(fixture.api.ensureBuvid(), errorKind('device'));
    assert.equal(fixture.randomCalls(), 0);
    assert.equal(fixture.values.has(BUVID_KEY), false);
    assert.deepEqual(fixture.writes, []);
    assert.equal(fixture.requests.length, 1);
  });
}

for (const identity of ['!', '~'.repeat(4096)]) {
  test(`gv accepts boundary-length printable ASCII identity (${identity.length} bytes)`, async () => {
    const fixture = loadProtocol({ replies: [{ status: 200, responseText: identity }] });
    assert.equal(await fixture.api.ensureBuvid(), identity);
    assert.equal(fixture.values.get(BUVID_KEY), identity);
  });
}

for (const [label, cached] of [
  ['empty', ''], ['null', null], ['numeric', 123], ['object', {}],
  ['whitespace', ' old-device '], ['NUL', 'old\0device'], ['non-ASCII', '设备'],
  ['oversized', 'x'.repeat(4097)],
]) {
  test(`corrupt ${label} buvid cache is an error, not a cache miss or fallback`, async () => {
    const fixture = loadProtocol({ storage: { [BUVID_KEY]: cached } });
    await assert.rejects(fixture.api.ensureBuvid(), errorKind('device'));
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.randomCalls(), 0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.values.get(BUVID_KEY), cached);
  });
}

test('aborted buvid initialization never generates or stores a fallback', async () => {
  const fixture = loadProtocol({ replies: [{ event: 'abort' }] });
  await assert.rejects(fixture.api.ensureBuvid(), errorKind('abort'));
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.randomCalls(), 0);
  assert.deepEqual(fixture.writes, []);
});

test('concurrent buvid consumers share one in-flight initialization', async () => {
  const fixture = loadProtocol({ replies: [{ defer: true }] });
  const pending = [fixture.api.ensureBuvid(), fixture.api.ensureBuvid(), fixture.api.getApiHeaders()];
  await new Promise(setImmediate);
  assert.equal(fixture.requests.length, 1);
  fixture.requests[0].onload({ status: 200, responseText: 'one-device' });
  const [first, second, headers] = await Promise.all(pending);
  assert.equal(first, 'one-device');
  assert.equal(second, 'one-device');
  assert.equal(headersOf({ headers }).buvid, 'one-device');
  assert.equal(fixture.writes.filter(([key]) => key === BUVID_KEY).length, 1);
});

test('concurrent aborted consumers all reject and later initialization can succeed', async () => {
  const fixture = loadProtocol({ replies: [{ defer: true }, { status: 200, responseText: 'retry-device' }] });
  const first = fixture.api.ensureBuvid();
  const second = fixture.api.ensureBuvid();
  const outcomes = Promise.allSettled([first, second]);
  await new Promise(setImmediate);
  assert.equal(fixture.requests.length, 1);
  fixture.requests[0].onabort({});
  for (const outcome of await outcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.kind, 'abort');
  }
  assert.equal(fixture.randomCalls(), 0);
  assert.equal(await fixture.api.ensureBuvid(), 'retry-device');
  assert.equal(fixture.requests.length, 2);
});


for (const [event, kind] of [['error', 'network'], ['timeout', 'timeout'], ['abort', 'abort']]) {
  test(`gmRequest turns GM ${event} callbacks into classified Error objects`, async () => {
    const fixture = loadProtocol({ replies: [{ event }] });
    await assert.rejects(fixture.api.gmRequest({ method: 'GET', url: API_URL }), errorKind(kind));
  });
}

test('requestJson reports HTTP failure before attempting JSON or business parsing', async () => {
  const fixture = withDevice([{ status: 502, responseText: '<html>bad gateway</html>' }]);
  await assert.rejects(fixture.api.requestJson({ method: 'GET', url: API_URL }), errorKind('http', error => {
    assert.equal(error.status, 502);
    assert.match(error.message, /502/);
  }));
});

test('requestJson distinguishes malformed JSON from HTTP failure', async () => {
  const fixture = withDevice([{ status: 200, responseText: '<not-json>' }]);
  await assert.rejects(fixture.api.requestJson({ method: 'GET', url: API_URL }), errorKind('json'));
});

for (const field of ['msg', 'message']) {
  test(`requestJson preserves unknown business code and server ${field}`, async () => {
    const response = { code: 987654, [field]: '服务器原文 +%中文', data: { detail: 'retained' } };
    const fixture = withDevice([{ status: 200, responseText: JSON.stringify(response) }]);
    await assert.rejects(fixture.api.requestJson({ method: 'GET', url: API_URL }), errorKind('business', error => {
      assert.equal(error.code, 987654);
      assert.match(error.message, /987654/);
      assert.ok(error.message.includes(response[field]));
      assert.deepEqual(plain(error.response), response);
    }));
  });
}

test('requestJson checkCode=false returns the complete nonzero response', async () => {
  const response = { code: 60043, msg: 'verify', data: { need_face_auth: false, risk_extra: { v_voucher: 'original' } } };
  const fixture = withDevice([{ status: 200, responseText: JSON.stringify(response) }]);
  assert.deepEqual(plain(await fixture.api.requestJson({ method: 'GET', url: API_URL }, false)), response);
});

test('requestJson checkCode=false still rejects HTTP and JSON failures', async () => {
  const fixture = withDevice([{ status: 403, responseText: '{}' }, { status: 200, responseText: '{' }]);
  await assert.rejects(fixture.api.requestJson({ method: 'GET', url: API_URL }, false), errorKind('http'));
  await assert.rejects(fixture.api.requestJson({ method: 'GET', url: API_URL }, false), errorKind('json'));
});

test('anonymous new_link keeps credentials and encoding in URL, injects native headers, and adds no signing parameters', async () => {
  const url = 'https://up.bilivideo.com/new_link?token=A%2B%2F%25&empty=&duplicate=1&duplicate=2';
  const fixture = withDevice([ok({ rtmp: { addr: 'rtmp://example.test/live/', code: 'secret' } })]);
  const result = await fixture.api.requestJson({ method: 'GET', url, anonymous: true });
  assert.equal(result.data.rtmp.code, 'secret');
  assert.equal(fixture.requests.length, 1);
  const request = fixture.requests[0];
  assert.equal(request.url, url);
  assert.equal(request.anonymous, true);
  assert.equal(request.data, undefined);
  const headers = headersOf(request);
  assert.equal(headers.buvid, CACHED_BUVID);
  assert.equal(headers['user-agent'], 'LiveHime/8.8.0.11119 os/Windows pc_app/livehime build/11119 osVer/10_0');
  assert.equal(headers.referer, 'https://live.bilibili.com/');
  assert.equal(headers.accept, 'application/json');
  assert.equal(headers.cookie, undefined);
});

for (const responseText of ['null', '[]', '{}', '{"code":"0"}', '{"code":null}']) {
  test(`requestJson rejects unusable JSON response shape: ${responseText}`, async () => {
    const fixture = withDevice([{ status: 200, responseText }]);
    await assert.rejects(fixture.api.requestJson({ method: 'GET', url: API_URL }), errorKind('json'));
  });
}

for (const method of ['GET', 'POST']) {
  test(`signedRequest ${method} signs fields, appends afterSign fields, and uses timestamp after device initialization`, async () => {
    const fixture = loadProtocol({ replies: [{ defer: true }, ok()] });
    const pending = fixture.api.signedRequest(method, API_URL, { uId: '123', note: '中 +%' }, {
      full: false, afterSign: { csrf: 'after-sign', csrf_token: 'after-sign' },
    });
    await new Promise(setImmediate);
    assert.equal(fixture.requests.length, 1);
    fixture.setTime(1700000123456);
    fixture.requests[0].onload({ status: 200, responseText: 'device-before-sign' });
    const response = await pending;
    assert.equal(response.code, 0);
    assert.equal(fixture.requests.length, 2);
    const request = fixture.requests[1];
    assert.equal(request.method, method);
    const params = method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : parseBody(request.data);
    const { sign, csrf, csrf_token, ...signed } = params;
    assert.equal(signed.ts, '1700000123');
    assert.equal(signed.uId, '123');
    assert.equal(signed.note, '中 +%');
    assert.equal(signed.version, undefined);
    assert.equal(sign, referenceSign(signed));
    assert.equal(csrf, 'after-sign');
    assert.equal(csrf_token, 'after-sign');
    assert.notEqual(sign, referenceSign({ ...signed, csrf, csrf_token }));
    assert.equal(headersOf(request).buvid, 'device-before-sign');
    if (method === 'GET') assert.equal(request.data, undefined);
    else {
      assert.equal(request.url, API_URL);
      assert.equal(request.data, referenceSerialize(params));
      assert.match(headersOf(request)['content-type'], /^application\/x-www-form-urlencoded(?:;|$)/);
    }
  });
}

function liveFixture(replies) {
  return loadProtocol({
    now: Date.now(),
    storage: {
      [BUVID_KEY]: CACHED_BUVID,
      bili_area_list_time: Date.now(),
      bili_area_list: JSON.stringify([{ id: 1, list: [{ id: 456 }] }]),
    },
    nodes: {
      'bili-room-id': { value: '' },
      'bili-area': { value: '456' },
      'bili-title': { value: 'Regression title' },
      'bili-orientation': { value: 'landscape' },
    },
    replies,
  });
}

const navReply = () => ok({ isLogin: true, mid: 999 });
const roomReply = (live = 0) => ok({ room_id: 123, uid: 999, live_status: live, lock_status: 0 });
const preflightReplies = () => [
  navReply(), roomReply(), ok({ realname_status: 1 }), ok(),
  ok({ cover_title_start_live_intercept: { need_intercept: false } }),
];

test('confirmed start without media credentials stays live and can be stopped with status readback', async () => {
  const fixture = liveFixture([
    ...preflightReplies(), ok({ live_key: 'not-a-stream-key', protocols_backup: [{ opaque: true }] }),
    navReply(), roomReply(1), ok({ status: 'PREPARING' }), navReply(), roomReply(),
  ]);
  await fixture.api.startLive();
  assert.deepEqual(plain(fixture.api.getLiveState()), { isLiveStarted: true, liveStatusUnknown: false, liveOperationPending: false });
  assert.equal(fixture.values.get('streamInfo'), null);
  assert.deepEqual(plain(fixture.values.get('bili_last_start_response').data.protocols_backup), [{ opaque: true }]);
  await fixture.api.startLive();
  assert.equal(fixture.requests.filter(request => request.url.endsWith('/startLive')).length, 1);
  await fixture.api.stopLive();
  assert.deepEqual(plain(fixture.api.getLiveState()), { isLiveStarted: false, liveStatusUnknown: false, liveOperationPending: false });
  assert.equal(fixture.values.get('isLiveStarted'), false);
  assert.equal(fixture.requests.filter(request => request.url.endsWith('/stopLive')).length, 1);
});

for (const live of [0, 1]) {
  test(`timed-out start queries room state ${live} without retransmission`, async () => {
    const fixture = liveFixture([...preflightReplies(), { event: 'timeout' }, navReply(), roomReply(live)]);
    await fixture.api.startLive();
    assert.deepEqual(plain(fixture.api.getLiveState()), { isLiveStarted: live === 1, liveStatusUnknown: false, liveOperationPending: false });
    assert.equal(fixture.requests.filter(request => request.url.endsWith('/startLive')).length, 1);
    assert.equal(fixture.requests.filter(request => new URL(request.url).pathname.endsWith('/GetInfo')).length, 2);
  });
}

test('unparseable start plus failed state readback persists unknown and prevents another start', async () => {
  const fixture = liveFixture([...preflightReplies(), { status: 200, responseText: '<invalid>' }, navReply(), { event: 'error' }]);
  await fixture.api.startLive();
  assert.deepEqual(plain(fixture.api.getLiveState()), { isLiveStarted: false, liveStatusUnknown: true, liveOperationPending: false });
  assert.equal(fixture.values.get('bili_live_status_unknown'), true);
  await fixture.api.startLive();
  assert.equal(fixture.requests.filter(request => request.url.endsWith('/startLive')).length, 1);
});

test('unverified identity prevents both title mutation and startLive', async () => {
  const fixture = liveFixture([navReply(), roomReply(), ok({ realname_status: 0 })]);
  await fixture.api.startLive();
  assert.equal(fixture.requests.some(request => request.method === 'POST'), false);
  assert.equal(fixture.values.get('isLiveStarted'), false);
});

test('concurrent clicks produce one start request and release the operation lock', async () => {
  const fixture = liveFixture([...preflightReplies(), { defer: true }]);
  const first = fixture.api.startLive();
  await fixture.api.startLive();
  await new Promise(setImmediate);
  const starts = fixture.requests.filter(request => request.url.endsWith('/startLive'));
  assert.equal(starts.length, 1);
  starts[0].onload(ok({}));
  await first;
  assert.equal(fixture.api.getLiveState().isLiveStarted, true);
  assert.equal(fixture.api.getLiveState().liveOperationPending, false);
});

test('60043 with need_face_auth=false retains voucher and never invokes face polling', async () => {
  const response = { code: 60043, msg: 'risk', data: { need_face_auth: false, risk_extra: { v_voucher: 'voucher' } } };
  const fixture = liveFixture([...preflightReplies(), { status: 200, responseText: JSON.stringify(response) }]);
  await fixture.api.startLive();
  assert.equal(fixture.values.get('bili_last_start_response').data.risk_extra.v_voucher, 'voucher');
  assert.equal(fixture.api.getLiveState().isLiveStarted, false);
  assert.equal(fixture.requests.some(request => request.url.endsWith('/IsUserIdentifiedByFaceAuth')), false);
});

test('stream selection preserves server order and falls back to the same candidate after dispatch failure', async () => {
  const fixture = withDevice([{ status: 503, responseText: 'unavailable' }]);
  const selected = await fixture.api.selectStream({
    protocols: [
      { protocol: 'srt', addr: 'srt://unsupported', code: 'srt' },
      { protocol: 'rtmp', addr: 'rtmp://first.example/live/', code: 'first', new_link: 'https://tcdns.myqcloud.com/dispatch?key=%2F' },
      { protocol: 'rtmp', addr: 'rtmp://second.example/live/', code: 'second' },
    ],
    rtmp: { addr: 'rtmp://legacy.example/live/', code: 'legacy' },
  });
  assert.equal(selected.code, 'first');
  assert.equal(fixture.requests[0].anonymous, true);
  assert.equal(fixture.requests[0].url, 'https://tcdns.myqcloud.com/dispatch?key=%2F');
});

test('dispatch text preserves encoded stream credentials and does not use live_key as media fallback', async () => {
  const fixture = withDevice([{ status: 200, responseText: 'rtmps://cdn.example/live/stream?key=%2F%2B&x=1' }]);
  const selected = await fixture.api.selectStream({ protocols: [{ protocol: 'rtmp', new_link: 'https://tcdns.myqcloud.com/dispatch?key=%2F' }] });
  assert.deepEqual(plain(selected), { addr: 'rtmps://cdn.example/live/', code: 'stream?key=%2F%2B&x=1' });
  await assert.rejects(fixture.api.selectStream({ live_key: 'not-media', sub_session_key: 'not-media' }));
});
