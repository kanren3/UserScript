// ==UserScript==
// @name         B站推流码获取工具
// @namespace    https://github.com/smathsp
// @version      1.15
// @description  获取第三方推流码
// @author       smathsp
// @license      GPL-3.0
// @match        *://*.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_notification
// @connect      api.live.bilibili.com
// @connect      passport.bilibili.com
// @connect      api.bilibili.com
// @connect      data.bilibili.com
// @connect      *.bilivideo.com
// @connect      *.biliapi.net
// @connect      *.bilibili.com
// @connect      tcdns.myqcloud.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // 存储键名常量
  const STORAGE_KEYS = {
    LAST_ROOM_ID: "bili_last_roomid",
    DARK_MODE: "bili_dark_mode",
    IS_LIVE_STARTED: "isLiveStarted",
    STREAM_INFO: "streamInfo",
    LAST_GROUP_ID: "bili_last_groupid",
    LAST_AREA_ID: "bili_last_areaid",
    AREA_LIST_TIME: "bili_area_list_time",
    AREA_LIST: "bili_area_list",
    USER_MID: "bili_user_mid",
    LAST_TITLE: "bili_last_title",
    BUVID: "bili_native_buvid",
    BUVID_SOURCE: "bili_native_buvid_source",
  };

  // API URL Constants
  const API_URL_AREA_LIST =
    "https://api.live.bilibili.com/xlive/app-blink/v1/preLive/GetAreaListForLive";
  const API_URL_START_LIVE =
    "https://api.live.bilibili.com/room/v1/Room/startLive";
  const API_URL_UPDATE_ROOM =
    "https://api.live.bilibili.com/room/v1/Room/update";
  const API_URL_STOP_LIVE =
    "https://api.live.bilibili.com/room/v1/Room/stopLive";
  const API_URL_FACE_AUTH =
    "https://api.live.bilibili.com/xlive/app-blink/v1/preLive/IsUserIdentifiedByFaceAuth";
  const API_URL_NAV = "https://api.bilibili.com/x/web-interface/nav";
  const API_URL_ROOM_INFO =
    "https://api.live.bilibili.com/xlive/app-blink/v1/room/GetInfo";
  const API_URL_PRECHECK =
    "https://api.live.bilibili.com/xlive/app-blink/v1/preLive/PreCheck";
  const API_URL_PRELIVE =
    "https://api.live.bilibili.com/xlive/app-blink/v1/preLive/PreLive";

  const LIVEHIME = Object.freeze({
    appkey: "aae92bc66f3edfab",
    platform: "pc_link",
    version: "8.8.0.11119",
    build: "11119",
    salt: "af125a0d5279fd576c1b4418a3e8276d",
    userAgent: "LiveHime/8.8.0.11119 os/Windows pc_app/livehime build/11119 osVer/10_0",
  });

  function protocolError(kind, message, details = {}) {
    return Object.assign(new Error(message), { kind }, details);
  }

  function requireProtocolString(value, label, allowEmpty = true) {
    if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.includes("\0")) {
      throw protocolError("validation", `${label} 必须是${allowEmpty ? "" : "非空"}字符串且不能包含 NUL`);
    }
    // encodeURIComponent rejects unpaired UTF-16 surrogates instead of replacing them.
    try {
      encodeURIComponent(value);
    } catch (cause) {
      throw protocolError("validation", `${label} 包含无效 Unicode 字符`, { cause });
    }
    return value;
  }

  function protocolEntries(params) {
    if (params === null || typeof params !== "object" || Object.prototype.toString.call(params) !== "[object Object]") {
      throw protocolError("validation", "参数必须是 string -> string 对象映射");
    }
    return Reflect.ownKeys(params).map((key) => {
      requireProtocolString(key, "参数名", false);
      const descriptor = Object.getOwnPropertyDescriptor(params, key);
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw protocolError("validation", "参数必须是可枚举的字符串数据属性");
      }
      return [key, requireProtocolString(descriptor.value, `参数 ${key}`)];
    });
  }

  function serializeParams(params) {
    const encoder = new TextEncoder();
    const entries = protocolEntries(params).map(([key, value]) => ({ key, value, bytes: encoder.encode(key) }));
    entries.sort((left, right) => {
      const length = Math.min(left.bytes.length, right.bytes.length);
      for (let i = 0; i < length; i++) {
        if (left.bytes[i] !== right.bytes[i]) return left.bytes[i] - right.bytes[i];
      }
      return left.bytes.length - right.bytes.length;
    });
    // Its safe set is exactly A-Z a-z 0-9 ! ' ( ) * - . _ ~; spaces stay %20.
    return entries.map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  }

  const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const MD5_CONSTANTS = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  function md5Ascii(text) {
    if (typeof text !== "string") throw protocolError("validation", "MD5 输入必须是 ASCII 字符串");
    const bytes = new Uint8Array(Math.ceil((text.length + 9) / 64) * 64);
    for (let i = 0; i < text.length; i++) {
      const byte = text.charCodeAt(i);
      if (byte > 0x7f) throw protocolError("validation", "MD5 输入必须是 ASCII 字符串");
      bytes[i] = byte;
    }
    bytes[text.length] = 0x80;
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 8, (text.length * 8) >>> 0, true);
    view.setUint32(bytes.length - 4, Math.floor(text.length / 0x20000000), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let offset = 0; offset < bytes.length; offset += 64) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, word;
        if (i < 16) {
          f = (b & c) | (~b & d);
          word = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          word = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          word = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          word = (7 * i) % 16;
        }
        const shift = MD5_SHIFTS[(i >>> 4) * 4 + (i % 4)];
        const sum = (a + f + MD5_CONSTANTS[i] + view.getUint32(offset + word * 4, true)) | 0;
        a = d;
        d = c;
        c = b;
        b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      }
      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }
    let hex = "";
    for (const word of [a0, b0, c0, d0]) {
      for (let shift = 0; shift < 32; shift += 8) hex += ((word >>> shift) & 0xff).toString(16).padStart(2, "0");
    }
    return hex;
  }

  function signParams(params) {
    if (params !== null && typeof params === "object" && Object.prototype.hasOwnProperty.call(params, "sign")) {
      throw protocolError("validation", "待签名参数不能包含 sign");
    }
    return md5Ascii(serializeParams(params) + LIVEHIME.salt);
  }

  function requirePositiveDecimal(value, label) {
    requireProtocolString(value, label, false);
    if (!/^[1-9][0-9]*(?![\s\S])/.test(value)) throw protocolError("validation", `${label} 必须是十进制正整数字符串`);
    return value;
  }

  function commonParams(full = true, ts = String(Math.floor(Date.now() / 1000))) {
    const params = { appkey: LIVEHIME.appkey, platform: LIVEHIME.platform, ts: requirePositiveDecimal(ts, "ts") };
    if (full) Object.assign(params, { version: LIVEHIME.version, build: LIVEHIME.build, access_key: "" });
    return params;
  }

  function buildStartLiveBody(roomId, areaId, csrf, orientation = "landscape", ts = String(Math.floor(Date.now() / 1000))) {
    if (orientation !== "landscape" && orientation !== "portrait") throw protocolError("validation", "直播方向必须是 landscape 或 portrait");
    const params = {
      ...commonParams(true, ts),
      room_id: requirePositiveDecimal(roomId, "room_id"),
      area_v2: requirePositiveDecimal(areaId, "area_v2"),
      type: orientation === "landscape" ? "2" : "1",
      csrf: requireProtocolString(csrf, "csrf", false),
      csrf_token: csrf,
    };
    return serializeParams({ ...params, sign: signParams(params) });
  }

  function buildStopLiveBody(roomId, csrf, ts = String(Math.floor(Date.now() / 1000))) {
    const params = { ...commonParams(true, ts), room_id: requirePositiveDecimal(roomId, "room_id") };
    requireProtocolString(csrf, "csrf", false);
    // stopLive differs from startLive: both CSRF fields are appended AFTER signing.
    return serializeParams({ ...params, sign: signParams(params), csrf, csrf_token: csrf });
  }

  // GM manages applicable browser cookies; never construct a Cookie header here.
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          ...options,
          timeout: Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 15000,
          onload: resolve,
          onerror: (cause) => reject(protocolError("network", "网络请求失败", { cause })),
          ontimeout: (cause) => reject(protocolError("timeout", "网络请求超时", { cause })),
          onabort: (cause) => reject(protocolError("abort", "请求已取消", { cause })),
        });
      } catch (cause) {
        reject(protocolError("request", "无法创建网络请求", { cause }));
      }
    });
  }

  function validateBuvid(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /[^\x21-\x7e]/.test(value)) {
      throw protocolError("device", "原生 buvid 格式损坏：需要 1–4096 个 ASCII 可见字符");
    }
    return value;
  }

  function fallbackBuvid() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    // Browsers cannot obtain the native OS PID; decimal 0 is our explicit browser adaptation.
    return `${uuid}0user`;
  }

  let buvidInitialization = null;
  async function ensureBuvid() {
    if (buvidInitialization) return buvidInitialization;
    const cached = GM_getValue(STORAGE_KEYS.BUVID, undefined);
    if (cached !== undefined) return validateBuvid(cached);
    buvidInitialization = (async () => {
      let value, source;
      try {
        // No account cookies, buvid, signing parameters, or JSON parsing during device discovery.
        const response = await gmRequest({ method: "GET", url: "https://data.bilibili.com/gv", anonymous: true });
        if (response.status !== 200) throw protocolError("http", `设备接口 HTTP ${response.status}`, { status: response.status });
        value = validateBuvid(response.responseText);
        source = "remote-gv";
      } catch (error) {
        if (!["http", "network", "timeout"].includes(error.kind)) throw error;
        value = fallbackBuvid();
        source = "local-uuid-v4-browser-pid-0";
      }
      GM_setValue(STORAGE_KEYS.BUVID_SOURCE, source);
      GM_setValue(STORAGE_KEYS.BUVID, value);
      return value;
    })();
    try {
      return await buvidInitialization;
    } finally {
      buvidInitialization = null;
    }
  }

  async function getApiHeaders() {
    return {
      "User-Agent": LIVEHIME.userAgent,
      Referer: "https://live.bilibili.com/",
      Accept: "application/json",
      buvid: await ensureBuvid(),
    };
  }

  async function sendJsonRequest(options, apiHeaders, checkCode) {
    const headers = {};
    for (const [key, value] of Object.entries(options.headers || {})) {
      const lower = key.toLowerCase();
      if (lower === "cookie") throw protocolError("validation", "Cookie 必须由 GM 浏览器会话管理");
      if (!["user-agent", "referer", "accept", "buvid", "host", "content-length", "content-type"].includes(lower)) headers[key] = value;
    }
    Object.assign(headers, apiHeaders);
    if ((options.method || "GET").toUpperCase() === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    const response = await gmRequest({ ...options, headers });
    if (response.status !== 200) throw protocolError("http", `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`, { status: response.status });
    let result;
    try {
      result = JSON.parse(response.responseText);
    } catch (cause) {
      throw protocolError("json", "服务器返回无效 JSON", { cause });
    }
    if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.code !== "number" || !Number.isFinite(result.code)) {
      throw protocolError("json", "服务器 JSON 缺少有效业务 code", { response: result });
    }
    if (checkCode && result.code !== 0) {
      const messages = [result.msg, result.message].filter((value) => typeof value === "string" && value.length > 0);
      throw protocolError("business", `业务错误 ${result.code}${messages.length ? `：${[...new Set(messages)].join("；")}` : ""}`, { code: result.code, response: result });
    }
    return result;
  }

  async function requestJson(options, checkCode = true) {
    return sendJsonRequest(options, await getApiHeaders(), checkCode);
  }

  async function signedRequest(method, url, fields = {}, { full = true, afterSign = {}, checkCode = true } = {}) {
    if (method !== "GET" && method !== "POST") throw protocolError("validation", "签名请求仅支持 GET 或 POST");
    const entries = protocolEntries(fields);
    const extraEntries = protocolEntries(afterSign);
    const reserved = new Set(["appkey", "platform", "ts", "version", "build", "access_key", "sign"]);
    for (const [key] of entries) {
      if (reserved.has(key)) throw protocolError("validation", `业务参数不能覆盖 ${key}`);
      reserved.add(key);
    }
    for (const [key] of extraEntries) {
      if (reserved.has(key)) throw protocolError("validation", `签名后参数不能覆盖 ${key}`);
    }
    const headers = await getApiHeaders();
    // Timestamp is sampled only after potentially slow device initialization is complete.
    const params = { ...commonParams(full), ...Object.fromEntries(entries) };
    const encoded = serializeParams({ ...params, sign: signParams(params), ...Object.fromEntries(extraEntries) });
    if (method === "GET") {
      const target = new URL(url);
      if (target.search || target.hash) throw protocolError("validation", "签名接口 URL 不能预含 query 或 fragment");
      return sendJsonRequest({ method, url: `${url}?${encoded}` }, headers, checkCode);
    }
    return sendJsonRequest({ method, url, data: encoded }, headers, checkCode);
  }

  // SVG 图标常量
  const SUN_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="5" fill="#FFD600"/><g stroke="#FFD600" stroke-width="2"><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></g></svg>';
  const MOON_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 12.79A9 9 0 0 1 12.21 3c-.55 0-.66.71-.19.93A7 7 0 1 0 20.07 12c.22.47-.38.74-.87.79z" fill="#888"/></svg>';
  const CLOSE_SVG =
    '<svg viewBox="0 0 1024 1024" width="16" height="16"><path d="M512 421.49 331.09 240.58c-24.74-24.74-64.54-24.71-89.28 0.03-24.74 24.74-24.72 64.54 0.03 89.28L422.75 510.8 241.84 691.71c-24.74 24.74-24.72 64.54 0.03 89.33 24.74 24.74 64.54 24.71 89.28-0.03L512 600.1l180.91 180.91c24.74 24.74 64.54 24.71 89.28-0.03 24.74-24.74 24.72-64.54-0.03-89.28L601.25 510.8 782.16 329.89c24.74-24.74 24.72-64.54-0.03-89.33-24.74-24.74-64.54-24.71-89.28 0.03L512 421.49z" fill="#888888"></path></svg>';

  // 插入全局样式表，统一亮暗色模式
  function insertGlobalStyle() {
    if (document.getElementById("bili-stream-global-style")) return;
    const style = document.createElement("style");
    style.id = "bili-stream-global-style";
    style.innerHTML = `
        :root {
            --bili-bg: rgba(255, 255, 255, 0.8);
            --bili-fg: #222;
            --bili-panel-shadow: 0 8px 32px rgba(0,0,0,0.15);
            --bili-border: rgba(238, 238, 238, 0.6);
            --bili-input-bg: rgba(255, 255, 255, 0.9);
            --bili-input-fg: #222;
            --bili-input-border: rgba(221, 221, 221, 0.8);
            --bili-tip-bg: rgba(254, 240, 241, 0.9);
            --bili-tip-fg: #d92b46;
            --bili-tip-border: #fb7299;
            --bili-btn-main: #fb7299;
            --bili-btn-main-hover: #fc8bab;
            --bili-btn-main-disabled: #bfbfbf;
            --bili-btn-stop: #ff4b4b;
            --bili-btn-stop-hover: #d9363e;
            --bili-btn-stop-disabled: #999;
            --bili-btn-text: #fff;
            --bili-title-color: #fb7299;
            --bili-label-color: #666;
            --bili-tip-yellow-bg: rgba(255, 251, 230, 0.9);
            --bili-tip-yellow-border: #faad14;
            --bili-tip-yellow-fg: #faad14;
            --bili-tip-green-bg: rgba(230, 255, 237, 0.9);
            --bili-tip-green-border: #52c41a;
            --bili-tip-green-fg: #389e0d;
        }
        .bili-dark-mode {
            --bili-bg: rgba(35, 35, 36, 0.8);
            --bili-fg: #eee;
            --bili-panel-shadow: 0 8px 32px rgba(0,0,0,0.4);
            --bili-border: rgba(68, 68, 68, 0.6);
            --bili-input-bg: rgba(24, 24, 26, 0.9);
            --bili-input-fg: #eee;
            --bili-input-border: rgba(68, 68, 68, 0.8);
            --bili-tip-bg: rgba(45, 35, 38, 0.9);
            --bili-tip-fg: #ffb6c1;
            --bili-tip-border: #fb7299;
            --bili-btn-main: #fb7299;
            --bili-btn-main-hover: #fc8bab;
            --bili-btn-main-disabled: #bfbfbf;
            --bili-btn-stop: #ff4b4b;
            --bili-btn-stop-hover: #d9363e;
            --bili-btn-stop-disabled: #999;
            --bili-btn-text: #fff;
            --bili-title-color: #fb7299;
            --bili-label-color: #aaa;
            --bili-tip-yellow-bg: rgba(58, 45, 26, 0.9);
            --bili-tip-yellow-border: #faad14;
            --bili-tip-yellow-fg: #ffd666;
            --bili-tip-green-bg: rgba(30, 43, 34, 0.9);
            --bili-tip-green-border: #52c41a;
            --bili-tip-green-fg: #b7eb8f;
        }
        #bili-stream-code-panel {
            background-color: var(--bili-bg) !important;
            color: var(--bili-fg) !important;
            box-shadow: var(--bili-panel-shadow) !important;
            border-radius: 12px;
            padding: 12px;
            font-family: "Microsoft YaHei", sans-serif;
            max-width: 280px;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--bili-border);
        }
        #bili-result {
            background-color: var(--bili-bg) !important;
            color: var(--bili-fg) !important;
            border: 1px solid var(--bili-border) !important;
            border-radius: 8px;
            margin-top: 15px;
            padding: 10px;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }
        .bili-input {
            background: var(--bili-input-bg) !important;
            color: var(--bili-input-fg) !important;
            border: 1px solid var(--bili-input-border) !important;
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 13px;
            width: 100%;
            box-sizing: border-box;
        }
        .bili-select {
            background: var(--bili-input-bg) !important;
            color: var(--bili-input-fg) !important;
            border: 1px solid var(--bili-input-border) !important;
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 13px;
            width: 100%;
            box-sizing: border-box;
        }
        #bili-room-id, #bili-title, #server-addr, #stream-code {
            background: var(--bili-input-bg) !important;
            color: var(--bili-input-fg) !important;
            border: 1px solid var(--bili-input-border) !important;
            border-radius: 4px;
            padding: 8px;
            font-size: 14px;
        }
        #bili-area-group, #bili-area {
            background: var(--bili-input-bg) !important;
            color: var(--bili-input-fg) !important;
            border: 1px solid var(--bili-input-border) !important;
            border-radius: 4px;
            padding: 8px;
            font-size: 14px;
        }
        .bili-important-tip {
            background-color: var(--bili-tip-bg) !important;
            color: var(--bili-tip-fg) !important;
            border-left: 4px solid var(--bili-tip-border) !important;
            border-radius: 6px;
            margin-top: 8px;
            padding: 8px;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
        }
        .bili-tip-yellow {
            background: var(--bili-tip-yellow-bg);
            border-left: 4px solid var(--bili-tip-yellow-border);
            color: var(--bili-tip-yellow-fg);
            border-radius: 6px;
            margin-top: 8px;
            padding: 8px;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
        }
        .bili-tip-green {
            background: var(--bili-tip-green-bg);
            border-left: 4px solid var(--bili-tip-green-border);
            color: var(--bili-tip-green-fg);
            border-radius: 6px;
            margin-top: 8px;
            padding: 8px;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
        }
        #bili-qr-container {
            background-color: var(--bili-bg) !important;
            color: var(--bili-fg) !important;
            border: 1px solid var(--bili-border) !important;
        }
        #bili-qr-container h3 {
            color: var(--bili-title-color) !important;
        }
        #bili-qr-container p {
            color: var(--bili-label-color) !important;
        }
        .bili-btn-main {
            background: var(--bili-btn-main);
            color: var(--bili-btn-text);
            border: none;
            border-radius: 4px;
            padding: 10px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.3s, opacity 0.3s;
        }
        .bili-btn-main:hover:not(:disabled) {
            background: var(--bili-btn-main-hover);
        }
        .bili-btn-main:disabled {
            background: var(--bili-btn-main-disabled);
            opacity: 0.5;
            cursor: not-allowed;
        }
        .bili-btn-stop {
            background: var(--bili-btn-stop);
            color: var(--bili-btn-text);
            border: none;
            border-radius: 4px;
            padding: 10px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.3s, opacity 0.3s;
        }
        .bili-btn-stop:hover:not(:disabled) {
            background: var(--bili-btn-stop-hover);
        }
        .bili-btn-stop:disabled {
            background: var(--bili-btn-stop-disabled);
            opacity: 0.5;
            cursor: not-allowed;
        }
        .bili-title {
            color: var(--bili-title-color) !important;
            font-size: 18px;
            margin: 0;
        }
        .bili-title:hover {
          opacity: 0.8;
          text-decoration: underline !important;
      }
        .bili-label {
            color: var(--bili-label-color);
            font-size: 14px;
        }
        .bili-copy-btn {
            margin-left: 5px;
            background: var(--bili-btn-main);
            color: var(--bili-btn-text);
            border: none;
            border-radius: 4px;
            padding: 6px 8px;
            cursor: pointer;
            transition: background 0.3s;
            font-size: 12px;
            flex-shrink: 0;
        }
        .bili-copy-btn:disabled {
            background: var(--bili-btn-main-disabled);
            cursor: not-allowed;
        }
        .bili-copy-btn:hover:not(:disabled) {
            background: var(--bili-btn-main-hover);
        }
        .bili-message {
            color: var(--bili-fg);
            font-size: 15px;
            margin: 0;
        }
        .bili-message-error {
            color: red;
        }
        .bili-status-success {
            background: #d4edda !important;
            color: #155724 !important;
            border: 1px solid #c3e6cb !important;
        }
        .bili-status-error {
            background: #f8d7da !important;
            color: #721c24 !important;
            border: 1px solid #f5c6cb !important;
        }
        `;
    document.head.appendChild(style);
  }

  // 全局变量
  let roomId = null; // 当前房间ID
  let csrf = null; // CSRF令牌
  let startLiveButton = null; // "开始直播"按钮引用
  let stopLiveButton = null; // "结束直播"按钮引用
  let editTitleButton = null; // "修改标题"按钮引用
  let editAreaButton = null; // "修改分区"按钮引用
  let isLiveStarted = GM_getValue(STORAGE_KEYS.IS_LIVE_STARTED, false); // 直播状态
  let streamInfo = GM_getValue(STORAGE_KEYS.STREAM_INFO, null); // 推流信息缓存

  let liveOperationPending = false;
  let liveStatusUnknown = GM_getValue("bili_live_status_unknown", false);
  let faceAuthCancelled = false;

  function saveLiveState(isLive, unknown = false) {
    isLiveStarted = isLive;
    liveStatusUnknown = unknown;
    GM_setValue(STORAGE_KEYS.IS_LIVE_STARTED, isLive);
    GM_setValue("bili_live_status_unknown", unknown);
    if (!isLive) {
      streamInfo = null;
      GM_setValue(STORAGE_KEYS.STREAM_INFO, null);
    }
    updateButtonsForLive(isLive);
  }



  // 初始化入口
  function init() {
    try {
      insertGlobalStyle(); // 插入全局样式
      removeExistingComponents(); // 清理旧组件
      createUI(); // 创建UI（只创建一次主面板）
      restoreLiveState(); // 恢复直播状态
      updateButtonsForLive(isLiveStarted);
    } catch (error) {
      console.error("B站推流码获取工具初始化失败:", error);
    }
  }

  // 移除已存在的组件
  function removeExistingComponents() {
    const existingPanel = document.getElementById("bili-stream-code-panel");
    if (existingPanel) {
      // 清理事件监听器
      if (existingPanel._clickOutsideHandler) {
        document.removeEventListener(
          "click",
          existingPanel._clickOutsideHandler,
          true
        );
      }
      existingPanel.remove();
    }
    const existingButton = document.getElementById("bili-stream-float-button");
    if (existingButton) existingButton.remove();
    // 清空按钮引用，防止旧引用干扰
    startLiveButton = null;
    stopLiveButton = null;
    editTitleButton = null;
    editAreaButton = null;
  }

  // 创建UI（只创建一次主面板）
  function createUI() {
    // 若主面板已存在则不再重复创建
    if (!document.getElementById("bili-stream-code-panel")) {
      const panel = createPanel();
      panel.style.display = "none";
    }
    // 浮动按钮可重复创建（防止丢失）
    createFloatButton();
  }

  // 创建面板
  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "bili-stream-code-panel";
    panel.style.cssText = `
          position: fixed;
          top: 70px;
          right: 10px;
          width: 240px;
          max-height: calc(100vh - 110px);
          overflow-y: auto;
          z-index: 10000;
          display: none;
      `;
    // 头部区域
    const header = createPanelHeader();
    panel.appendChild(header);
    // 表单区域
    const form = createPanelForm();
    panel.appendChild(form);
    // 结果区域
    const resultArea = document.createElement("div");
    resultArea.id = "bili-result";
    resultArea.style.cssText = `
          margin-top: 15px;
          padding: 10px;
          border: 1px solid #eee;
          border-radius: 4px;
          background-color: #f9f9f9;
          display: none;
      `;
    panel.appendChild(resultArea);
    document.body.appendChild(panel);

    // 新增：设置点击外部隐藏面板
    setupClickOutsideHandler(panel);

    return panel;
  }

  // 新增：设置点击外部隐藏面板的处理器
  function setupClickOutsideHandler(panel) {
    function handleClickOutside(event) {
      // 只在面板可见时处理
      if (panel.style.display === "none") return;

      // 检查点击目标
      const floatButton = document.getElementById("bili-stream-float-button");
      const isClickInPanel = panel.contains(event.target);
      const isClickOnFloatButton =
        floatButton && floatButton.contains(event.target);

      // 点击面板外且不是浮动按钮时隐藏面板
      if (!isClickInPanel && !isClickOnFloatButton) {
        panel.style.display = "none";
      }
    }

    // 使用捕获阶段监听，确保在其他事件处理器之前执行
    document.addEventListener("click", handleClickOutside, true);

    // 存储处理器引用，便于清理
    panel._clickOutsideHandler = handleClickOutside;
  }

  // 创建面板头部
  function createPanelHeader() {
    const header = document.createElement("div");
    header.style.cssText =
      "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;";

    // 标题 - 改为可点击的链接
    const title = document.createElement("a");
    title.textContent = "推流码获取";
    title.className = "bili-title";
    title.href = "https://github.com/smathsp/UserScript";
    title.target = "_blank";
    title.style.cssText = "text-decoration: none; cursor: pointer;";
    title.title = "访问 GitHub 仓库";

    // 亮暗模式切换按钮
    const modeBtn = document.createElement("button");
    modeBtn.id = "bili-mode-toggle";
    modeBtn.style.cssText =
      "width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; margin-left: 8px;";
    // SVG 图标
    let isDarkMode = GM_getValue(STORAGE_KEYS.DARK_MODE, false);
    modeBtn.innerHTML = isDarkMode ? MOON_SVG : SUN_SVG;
    modeBtn.title = isDarkMode ? "切换为亮色模式" : "切换为暗色模式";
    modeBtn.onclick = function () {
      isDarkMode = !isDarkMode;
      GM_setValue(STORAGE_KEYS.DARK_MODE, isDarkMode);
      modeBtn.innerHTML = isDarkMode ? MOON_SVG : SUN_SVG;
      modeBtn.title = isDarkMode ? "切换为亮色模式" : "切换为暗色模式";
      applyColorMode(isDarkMode);
    };
    // 首次渲染时应用模式
    setTimeout(() => applyColorMode(isDarkMode), 0);

    // 关闭按钮
    const closeButton = document.createElement("button");
    closeButton.innerHTML = CLOSE_SVG;
    closeButton.style.cssText =
      "width: 24px; height: 24px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;";
    closeButton.onclick = () => {
      document.getElementById("bili-stream-code-panel").style.display = "none";
    };

    // 头部右侧按钮组
    const rightBtns = document.createElement("div");
    rightBtns.style.cssText = "display: flex; align-items: center; gap: 4px;";
    rightBtns.appendChild(modeBtn);
    rightBtns.appendChild(closeButton);

    header.appendChild(title);
    header.appendChild(rightBtns);
    return header;
  }

  // 亮暗模式应用函数
  function applyColorMode(isDark) {
    // 只切换 class，不再手动设置 style
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("bili-dark-mode");
    } else {
      root.classList.remove("bili-dark-mode");
    }
  }

  // 创建面板表单
  function createPanelForm() {
    const form = document.createElement("div");
    form.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

    // 房间ID输入
    form.appendChild(createRoomIdInput());

    // 分区选择
    const areaSelectionElement = createAreaSelection();
    form.appendChild(areaSelectionElement);

    if (areaSelectionElement.loadAndBindAreaListPromise) {
      areaSelectionElement.loadAndBindAreaListPromise
        .then(() => {
          autoFillRoomId();
        })
        .catch((error) => {
          console.error(
            "Error during area list loading, or in autoFillRoomId:",
            error
          );
          setTimeout(autoFillRoomId, 300);
        });
    } else {
      console.warn(
        "loadAndBindAreaListPromise not found, falling back for autoFillRoomId."
      );
      setTimeout(autoFillRoomId, 300);
    }

    // 标题输入
    form.appendChild(createTitleInput());

    const orientation = document.createElement("select");
    orientation.id = "bili-orientation";
    orientation.className = "bili-select";
    orientation.setAttribute("aria-label", "直播方向");
    orientation.append(new Option("横屏直播", "landscape"), new Option("竖屏直播", "portrait"));
    orientation.value = GM_getValue("bili_orientation", "landscape");
    orientation.onchange = () => GM_setValue("bili_orientation", orientation.value);
    form.appendChild(orientation);

    // 按钮组
    form.appendChild(createButtonGroup());

    return form;
  }

  // 创建房间ID输入
  function createRoomIdInput() {
    const container = document.createElement("div");
    container.style.cssText =
      "display: flex; flex-direction: column; gap: 5px;";
    const label = document.createElement("label");
    label.textContent = "房间ID:";
    label.className = "bili-label";

    const input = document.createElement("input");
    input.type = "text";
    input.id = "bili-room-id";
    input.placeholder = "留空自动查询本人房间";
    input.className = "bili-input";
    // 新增：输入时保存
    input.addEventListener("blur", function () {
      GM_setValue(STORAGE_KEYS.LAST_ROOM_ID, input.value.trim());
    });

    container.appendChild(label);
    container.appendChild(input);

    return container;
  }

  // 创建分区选择
  function createAreaSelection() {
    const container = document.createElement("div");
    container.id = "bili-area-selection-container";
    container.style.cssText =
      "display: flex; flex-direction: column; gap: 5px;";
    const label = document.createElement("label");
    label.textContent = "直播分区:";
    label.className = "bili-label";

    // 加载指示器
    const loading = document.createElement("div");
    loading.id = "bili-area-loading";
    loading.textContent = "正在加载分区列表...";
    loading.style.cssText =
      "padding: 8px; color: #666; font-size: 14px; text-align: center; cursor: pointer;";

    // 分区组选择器
    const groupSelect = document.createElement("select");
    groupSelect.id = "bili-area-group";
    groupSelect.className = "bili-select";
    groupSelect.style.cssText = "margin-bottom: 8px; display: none;";

    // 子分区选择器
    const areaSelect = document.createElement("select");
    areaSelect.id = "bili-area";
    areaSelect.className = "bili-select";
    areaSelect.style.cssText = "display: none;";

    // 统一事件绑定
    groupSelect.addEventListener("change", function () {
      const areaList = getCachedAreaList() || [];
      const selectedIndex = this.options[this.selectedIndex].dataset.index;
      GM_setValue(STORAGE_KEYS.LAST_GROUP_ID, groupSelect.value);
      updateAreaSelectors(
        areaList,
        Number(selectedIndex),
        groupSelect,
        areaSelect
      );
    });
    areaSelect.addEventListener("change", function () {
      GM_setValue(STORAGE_KEYS.LAST_AREA_ID, areaSelect.value);
      GM_setValue(STORAGE_KEYS.LAST_GROUP_ID, groupSelect.value);
    });
    loading.onclick = function () {
      if (
        loading.style.color === "rgb(255, 75, 75)" ||
        loading.style.color === "#ff4b4b"
      ) {
        loadAndBindAreaList().catch(() => {}); // 错误已显示在加载控件中
      }
    };

    container.appendChild(label);
    container.appendChild(loading);
    container.appendChild(groupSelect);
    container.appendChild(areaSelect);

    // 合并后的分区刷新函数
    function updateAreaSelectors(
      areaList,
      groupIdx = 0,
      groupSel = groupSelect,
      areaSel = areaSelect
    ) {
      groupSel.innerHTML = "";
      areaSel.innerHTML = "";
      areaList.forEach((group, idx) => {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name;
        option.dataset.index = idx;
        groupSel.appendChild(option);
      });
      // 恢复上次大类
      const lastGroupId = GM_getValue(STORAGE_KEYS.LAST_GROUP_ID);
      if (lastGroupId) {
        for (let i = 0; i < groupSel.options.length; i++) {
          if (groupSel.options[i].value == lastGroupId) {
            groupSel.selectedIndex = i;
            groupIdx = i;
            break;
          }
        }
      }
      if (areaList[groupIdx] && areaList[groupIdx].list) {
        areaList[groupIdx].list.forEach((area) => {
          const option = document.createElement("option");
          option.value = area.id;
          option.textContent = area.name;
          areaSel.appendChild(option);
        });
      }
      // 恢复上次分区id
      const lastAreaId = GM_getValue(STORAGE_KEYS.LAST_AREA_ID);
      if (lastAreaId && areaSel.options.length > 0) {
        for (let i = 0; i < areaSel.options.length; i++) {
          if (areaSel.options[i].value == lastAreaId) {
            areaSel.selectedIndex = i;
            break;
          }
        }
      }
      // 显示选择器
      loading.style.display = "none";
      groupSel.style.display = "block";
      areaSel.style.display = "block";
    }

    // 加载分区数据
    async function loadAndBindAreaList() {
      loading.style.display = "block";
      groupSelect.style.display = "none";
      areaSelect.style.display = "none";
      loading.textContent = "正在加载分区列表...";
      loading.style.color = "#666";
      try {
        let list = getCachedAreaList();
        if (!list) {
          const result = await signedRequest("GET", API_URL_AREA_LIST, {
            current_area_id: String(GM_getValue(STORAGE_KEYS.LAST_AREA_ID, "0")),
          });
          list = Array.isArray(result.data) ? result.data : result.data?.list;
          if (!Array.isArray(list) || !list.every((group) => Array.isArray(group.list))) {
            throw new Error("分区目录格式异常");
          }
          cacheAreaList(list);
        }
        updateAreaSelectors(list, 0, groupSelect, areaSelect);
      } catch (error) {
        showAreaLoadError();
        loading.textContent = `分区加载失败：${error.message}（点击重试）`;
        throw error;
      }
    }

    // 将 Promise 附加到容器元素，以便在 createUI 中访问
    container.loadAndBindAreaListPromise = loadAndBindAreaList();
    return container;
  }

  // 创建标题输入
  function createTitleInput() {
    const container = document.createElement("div");
    container.style.cssText =
      "display: flex; flex-direction: column; gap: 5px;";

    const label = document.createElement("label");
    label.textContent = "直播标题:";
    label.className = "bili-label";

    const input = document.createElement("input");
    input.type = "text";
    input.id = "bili-title";
    input.placeholder = "请输入直播标题";
    input.className = "bili-input";
    // 新增：输入时保存
    input.addEventListener("blur", function () {
      GM_setValue(STORAGE_KEYS.LAST_TITLE, input.value.trim());
    });

    container.appendChild(label);
    container.appendChild(input);

    return container;
  }

  // 创建按钮组
  function createButtonGroup() {
    const container = document.createElement("div");
    container.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 10px;";

    // 修改按钮组（直播中显示）
    const editButtonsContainer = document.createElement("div");
    editButtonsContainer.id = "bili-edit-buttons";
    editButtonsContainer.style.cssText = "display: none; gap: 8px;";

    // 修改标题按钮
    editTitleButton = document.createElement("button");
    editTitleButton.textContent = "修改标题";
    editTitleButton.className = "bili-btn-main";
    editTitleButton.style.cssText = "flex: 1; font-size: 13px; padding: 8px;";
    editTitleButton.onclick = editLiveTitle;

    // 修改分区按钮
    editAreaButton = document.createElement("button");
    editAreaButton.textContent = "修改分区";
    editAreaButton.className = "bili-btn-main";
    editAreaButton.style.cssText = "flex: 1; font-size: 13px; padding: 8px;";
    editAreaButton.onclick = editLiveArea;

    editButtonsContainer.appendChild(editTitleButton);
    editButtonsContainer.appendChild(editAreaButton);

    // 主按钮组
    const mainButtonsContainer = document.createElement("div");
    mainButtonsContainer.style.cssText = "display: flex; gap: 10px;";

    // 开始直播按钮
    startLiveButton = document.createElement("button");
    startLiveButton.textContent = "获取推流码并开始直播";
    startLiveButton.className = "bili-btn-main";
    startLiveButton.style.flex = "1";
    startLiveButton.onclick = startLive;

    // 结束直播按钮
    stopLiveButton = document.createElement("button");
    stopLiveButton.textContent = "结束直播";
    stopLiveButton.className = "bili-btn-stop";
    stopLiveButton.style.flex = "1";
    stopLiveButton.disabled = true;
    stopLiveButton.onclick = stopLive;

    mainButtonsContainer.appendChild(startLiveButton);
    mainButtonsContainer.appendChild(stopLiveButton);

    container.appendChild(editButtonsContainer);
    container.appendChild(mainButtonsContainer);

    return container;
  }

  // 创建浮动按钮
  function createFloatButton() {
    const button = document.createElement("div");
    button.id = "bili-stream-float-button";
    button.innerHTML =
      '<svg viewBox="0 0 1024 1024" width="24" height="24"><path d="M718.3 183.7H305.7c-122 0-221 99-221 221v214.6c0 122 99 221 221 221h412.6c122 0 221-99 221-221V404.7c0-122-99-221-221-221z m159.1 435.6c0 87.6-71.5 159.1-159.1 159.1H305.7c-87.6 0-159.1-71.5-159.1-159.1V404.7c0-87.6 71.5-159.1 159.1-159.1h412.6c87.6 0 159.1 71.5 159.1 159.1v214.6z" fill="#FFFFFF"></path><path d="M415.5 532.2v-131c0-7.1 3.8-13.6 10-17.1 6.2-3.5 13.7-3.5 19.9 0l131 75.1c6.2 3.5 10 10.1 10 17.1 0 7.1-3.8 13.6-10 17.1l-131 65.5c-6.2 3.5-13.7 3.5-19.9 0-6.2-3.5-10-10.1-10-17.1v-9.6z" fill="#FFFFFF"></path></svg>';
    button.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background-color: #fb7299;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
            z-index: 10001;
            transition: transform 0.3s;
        `;
    button.onmouseover = function () {
      this.style.transform = "scale(1.1)";
    };
    button.onmouseout = function () {
      this.style.transform = "scale(1)";
    };
    button.onclick = togglePanel;

    document.body.appendChild(button);
    return button;
  }

  // 检查实际直播状态
  async function checkActualLiveStatus(force = false) {
    if (liveOperationPending && !force) return;
    if (!force) {
      liveOperationPending = true;
      updateButtonsForLive(isLiveStarted);
    }
    try {
      const ownRoom = await getOwnRoom();
      const changed = isLiveStarted !== (ownRoom.live_status === 1) || liveStatusUnknown;
      saveLiveState(ownRoom.live_status === 1);
      if (changed) showMessage(isLiveStarted ? "服务器确认房间正在直播" : "服务器确认房间未开播");
      return ownRoom;
    } catch (error) {
      showMessage(`无法确认房间状态：${error.message}`, true);
      return null;
    } finally {
      if (!force) {
        liveOperationPending = false;
        updateButtonsForLive(isLiveStarted);
      }
    }
  }

  async function getOwnRoom(expectedRoomId = "") {
    const nav = await signedRequest("GET", API_URL_NAV, {}, { full: false });
    if (nav.data?.isLogin !== true || !/^[1-9]\d*$/.test(String(nav.data.mid))) {
      throw new Error("请先登录 B 站");
    }
    const mid = String(nav.data.mid);
    const result = await signedRequest("GET", API_URL_ROOM_INFO, { uId: mid });
    const data = result.data;
    if (!data || !/^[1-9]\d*$/.test(String(data.room_id))) throw new Error("当前账号没有有效直播间");
    if (data.uid !== undefined && String(data.uid) !== mid) throw new Error("直播间不属于当前登录账号");
    const ownId = String(data.room_id);
    if (expectedRoomId && expectedRoomId !== ownId) throw new Error(`请输入本人真实房间 ID：${ownId}`);
    if (![0, 1, 2].includes(data.live_status)) throw new Error("房间直播状态无法识别，停止操作");
    if (roomId !== ownId) {
      streamInfo = null;
      GM_setValue(STORAGE_KEYS.STREAM_INFO, null);
    }
    roomId = ownId;
    GM_setValue(STORAGE_KEYS.LAST_ROOM_ID, roomId);
    GM_setValue(STORAGE_KEYS.USER_MID, mid);
    const input = document.getElementById("bili-room-id");
    if (input) input.value = roomId;
    return data;
  }

  function requireCsrf() {
    csrf = getCsrfToken();
    if (!csrf) throw new Error("无法获取 bili_jct，请在已登录的 B 站页面操作");
    return csrf;
  }

  async function preflightStart(expectedRoomId, areaId, title) {
    requireCsrf();
    const ownRoom = await getOwnRoom(expectedRoomId);
    saveLiveState(ownRoom.live_status === 1);
    if (isLiveStarted) throw new Error("房间已在直播，请勿重复开播");
    const locked = ownRoom.lock_status ?? ownRoom.is_locked;
    if (locked !== 0 && locked !== false) throw new Error("直播间已锁定或无法确认锁定状态");
    const areas = getCachedAreaList();
    if (!/^[1-9]\d*$/.test(areaId) || !areas?.some((group) => group.list?.some((area) => String(area.id) === areaId))) {
      throw new Error("请选择有效的二级直播分区");
    }
    const token = requireCsrf();
    const check = await signedRequest("GET", API_URL_PRECHECK, {}, {
      full: false, afterSign: { csrf: token, csrf_token: token },
    });
    if (check.data?.realname_status !== 1) throw new Error("请先在官方直播中心完成实名认证");
    if (!await updateLiveTitle(roomId, title)) throw new Error("设置直播标题失败，已停止开播");
    const preLive = await signedRequest("GET", API_URL_PRELIVE, {}, {
      afterSign: {
        mobi_app: "pc_link", cover: "true", area: "true", title: "true",
        schedule: "true", coverVertical: "true", liveDirectionType: "0",
      },
    });
    const intercept = preLive.data?.cover_title_start_live_intercept;
    if (intercept?.need_intercept !== false) {
      throw new Error(intercept?.msg || intercept?.message || "标题／封面预检未通过，请前往官方直播中心完善设置");
    }
  }

  // 显示/隐藏面板
  async function togglePanel() {
    const panel = document.getElementById("bili-stream-code-panel");
    if (!panel) return; // 理论上不会发生

    const isShowing = panel.style.display === "none" || !panel.style.display;
    panel.style.display = isShowing ? "block" : "none";

    // 如果是显示面板，检查直播状态
    if (isShowing) {
      // 延迟一点检查，确保面板已显示
      setTimeout(() => {
        checkActualLiveStatus();
      }, 100);
    }
  }

  // 检查浮动按钮
  function checkFloatButton() {
    if (!document.getElementById("bili-stream-float-button")) {
      createFloatButton();
    }
  }

  // 显示分区加载错误信息
  function showAreaLoadError() {
    const loading = document.getElementById("bili-area-loading");
    if (loading) {
      loading.textContent = "无法加载分区列表，请稍后刷新重试";
      loading.style.color = "#ff4b4b";
    }

    // 显示通知
    GM_notification({
      text: "无法加载直播分区列表，请检查网络连接或登录状态",
      title: "B站推流码获取工具",
      timeout: 5000,
    });
  }

  // 更新分区选择器
  function updateAreaSelectors(areaList) {
    const loading = document.getElementById("bili-area-loading");
    const groupSelect = document.getElementById("bili-area-group");
    const areaSelect = document.getElementById("bili-area");
    // 防止 loading 取不到时报错
    if (!loading || !groupSelect || !areaSelect) return;

    // 隐藏加载提示
    loading.style.display = "none";

    // 显示选择器
    groupSelect.style.display = "block";
    areaSelect.style.display = "block";

    // 清空选择器
    groupSelect.innerHTML = "";
    areaSelect.innerHTML = "";

    // 添加分区大类
    areaList.forEach((group, index) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      option.dataset.index = index;
      groupSelect.appendChild(option);
    });

    // 默认显示第一个分区大类的子分区
    if (areaList.length > 0 && areaList[0].list) {
      areaList[0].list.forEach((area) => {
        const option = document.createElement("option");
        option.value = area.id;
        option.textContent = area.name;
        areaSelect.appendChild(option);
      });
    }

    // 分区大类变更事件
    groupSelect.addEventListener("change", function () {
      const selectedIndex = this.options[this.selectedIndex].dataset.index;
      const selectedGroup = areaList[selectedIndex];

      // 清空子分区
      areaSelect.innerHTML = "";

      if (selectedGroup && selectedGroup.list) {
        selectedGroup.list.forEach((area) => {
          const option = document.createElement("option");
          option.value = area.id;
          option.textContent = area.name;
          areaSelect.appendChild(option);
        });
      }
    });
  }

  // 获取缓存的分区列表
  function getCachedAreaList() {
    const timeStamp = GM_getValue(STORAGE_KEYS.AREA_LIST_TIME);
    if (!timeStamp) return null;

    const now = new Date().getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    // 超过一天则认为过期
    if (now - timeStamp > oneDay) return null;

    const listStr = GM_getValue(STORAGE_KEYS.AREA_LIST);
    if (!listStr) return null;

    try {
      return JSON.parse(listStr);
    } catch (e) {
      return null;
    }
  }

  // 缓存分区列表
  function cacheAreaList(areaList) {
    GM_setValue(STORAGE_KEYS.AREA_LIST, JSON.stringify(areaList));
    GM_setValue(STORAGE_KEYS.AREA_LIST_TIME, new Date().getTime());
  }

  // 拆分 autoFillRoomId 内部逻辑
  function getRoomIdFromHistory() {
    return GM_getValue(STORAGE_KEYS.LAST_ROOM_ID);
  }
  function getCsrfToken() {
    const cookie = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("bili_jct="));
    return cookie ? cookie.slice("bili_jct=".length) : null;
  }
  function autoFillRoomId() {
    const lastRoomId = GM_getValue(STORAGE_KEYS.LAST_ROOM_ID);
    const lastAreaId = GM_getValue(STORAGE_KEYS.LAST_AREA_ID);
    const lastTitle = GM_getValue(STORAGE_KEYS.LAST_TITLE);
    if (streamInfo && streamInfo.roomId) {
      document.getElementById("bili-room-id").value = streamInfo.roomId;
      roomId = streamInfo.roomId;
      if (document.getElementById("bili-title") && streamInfo.title) {
        document.getElementById("bili-title").value = streamInfo.title;
      }
    } else {
      // 仅使用历史记录获取房间ID，取消自动获取功能
      const foundRoomId = getRoomIdFromHistory();
      if (foundRoomId) {
        document.getElementById("bili-room-id").value = foundRoomId;
        roomId = foundRoomId;
      } else if (lastRoomId) {
        document.getElementById("bili-room-id").value = lastRoomId;
        roomId = lastRoomId;
      }
    }
    if (document.getElementById("bili-title") && lastTitle) {
      document.getElementById("bili-title").value = lastTitle;
    }
    // 移除 setTimeout，因为现在依赖 Promise
    // setTimeout(() => {
    if (lastAreaId) {
      const areaSelect = document.getElementById("bili-area");
      if (areaSelect) {
        for (let i = 0; i < areaSelect.options.length; i++) {
          if (areaSelect.options[i].value == lastAreaId) {
            areaSelect.selectedIndex = i;
            break;
          }
        }
      }
    }
    // }, 500);
    csrf = getCsrfToken();
  }


  // 更新按钮状态（开始/结束直播）
  function updateButtonsForLive(isLive) {
    if (startLiveButton) {
      startLiveButton.disabled = liveOperationPending || liveStatusUnknown || isLive;
    }
    if (stopLiveButton) {
      stopLiveButton.disabled = liveOperationPending || !(isLive || liveStatusUnknown);
    }
    
    // 控制修改按钮的显示
    const editButtonsContainer = document.getElementById("bili-edit-buttons");
    if (editButtonsContainer) {
      if (isLive) {
        editButtonsContainer.style.display = "flex";
      } else {
        editButtonsContainer.style.display = "none";
      }
    }
    for (const id of ["bili-room-id", "bili-area-group", "bili-area", "bili-title", "bili-orientation"]) {
      const input = document.getElementById(id);
      if (input) input.disabled = liveOperationPending || ((isLive || liveStatusUnknown) && id === "bili-room-id");
    }
    if (editTitleButton) editTitleButton.disabled = liveOperationPending;
    if (editAreaButton) editAreaButton.disabled = liveOperationPending;
  }

  // 恢复直播状态
  function restoreLiveState() {
    if (isLiveStarted || liveStatusUnknown) {
      setTimeout(() => {
        const panel = document.getElementById("bili-stream-code-panel");
        if (panel) {
          // 更新按钮状态
          updateButtonsForLive(true);
          if (streamInfo) restoreStreamInfo();
          else showMessage(liveStatusUnknown ? "上次请求结果未知，打开面板查询房间状态" : "房间已开播，尚无可用推流地址");
        }
      }, 500);
    }
  }

  // 推流信息区输入框和按钮也用 class
  function restoreStreamInfo() {
    if (!streamInfo) return;
    const resultArea = document.getElementById("bili-result");
    if (!resultArea) return;
    const rtmpAddr = streamInfo.rtmpAddr;
    const rtmpCode = streamInfo.rtmpCode;

    const resultHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <h3 class="bili-title" style="font-size: 16px;">推流信息 (进行中)</h3>
                <div>
                    <p style="margin: 0; font-weight: bold;">服务器地址:</p>
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <input id="server-addr" readonly class="bili-input" />
                        <button id="copy-addr" class="bili-copy-btn">复制</button>
                    </div>
                    <p style="margin: 0; font-weight: bold;">推流码:</p>
                    <div style="display: flex; align-items: center;">
                        <input id="stream-code" readonly class="bili-input" />
                        <button id="copy-code" class="bili-copy-btn">复制</button>
                    </div>
                </div>
                <div class="bili-important-tip">
                    <p style="margin: 0; font-weight: bold;">重要提示:</p>
                    <p style="margin: 3px 0 0; font-size: 13px;">1. 长时间无信号会自动关闭直播</p>
                    <p style="margin: 3px 0 0; font-size: 13px;">2. 推流码如果变动会有提示</p>
                </div>
            </div>
        `;

    resultArea.innerHTML = resultHTML;
    for (const [id, value] of [["server-addr", rtmpAddr], ["stream-code", rtmpCode]]) {
      const input = document.getElementById(id);
      input.value = value;
      input.title = value;
    }
    resultArea.style.display = "block";
    // 添加复制按钮事件
    const copyAddrBtn = document.getElementById("copy-addr");
    if (copyAddrBtn) {
      copyAddrBtn.addEventListener("click", function () {
        copyToClipboardWithButton(rtmpAddr, copyAddrBtn);
      });
    }
    const copyCodeBtn = document.getElementById("copy-code");
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", function () {
        copyToClipboardWithButton(rtmpCode, copyCodeBtn);
      });
    }
    // 新增：推流信息区插入后，重新应用颜色模式
    const isDarkMode = GM_getValue("bili_dark_mode", false);
    applyColorMode(isDarkMode);
  }

  // 修改直播标题
  async function editLiveTitle() {
    if (!isLiveStarted || !roomId) {
      showMessage("请先开始直播", true);
      return;
    }

    // 直接使用UI输入框的值
    const newTitle = document.getElementById("bili-title").value.trim();
    if (!newTitle) {
      showMessage("请输入直播标题", true);
      return;
    }

    try {
      const success = await updateLiveTitle(roomId, newTitle);
      if (success) {
        // 更新本地存储的标题信息
        if (streamInfo) {
          streamInfo.title = newTitle;
          GM_setValue(STORAGE_KEYS.STREAM_INFO, streamInfo);
        }
        GM_setValue(STORAGE_KEYS.LAST_TITLE, newTitle);
        showMessage("直播标题修改成功");
      } else {
        showMessage("修改直播标题失败，请检查权限或网络连接", true);
      }
    } catch (error) {
      console.error("修改标题错误:", error);
      showMessage(`修改直播标题失败：${error.message}`, true);
    }
  }

  // 修改直播分区
  async function editLiveArea() {
    if (!isLiveStarted || !roomId) {
      showMessage("请先开始直播", true);
      return;
    }

    const areaSelect = document.getElementById("bili-area");
    const newAreaId = areaSelect.value;

    try {
      // 直接更新分区，不重新开播
      const success = await updateLiveArea(roomId, newAreaId);
      
      if (success) {
        // 更新本地存储的分区信息
        if (streamInfo) {
          streamInfo.areaId = newAreaId;
          GM_setValue(STORAGE_KEYS.STREAM_INFO, streamInfo);
        }
        GM_setValue(STORAGE_KEYS.LAST_AREA_ID, newAreaId);
        showMessage("分区修改成功，直播继续进行中");
      } else {
        showMessage("修改分区失败，请检查权限或网络连接", true);
      }
    } catch (error) {
      console.error("修改分区错误:", error);
      showMessage(`修改直播分区失败：${error.message}`, true);
    }
  }

  // 开始直播
  async function startLive() {
    if (liveOperationPending || isLiveStarted || liveStatusUnknown) return;
    const expectedRoomId = document.getElementById("bili-room-id").value.trim();
    const areaId = document.getElementById("bili-area").value;
    const liveTitle = document.getElementById("bili-title").value.trim();
    const orientation = document.getElementById("bili-orientation").value;
    if (!liveTitle) return showMessage("请输入直播标题", true);
    liveOperationPending = true;
    updateButtonsForLive(isLiveStarted);
    let sent = false;
    try {
      showMessage("正在检查登录、直播间及开播条件...");
      await preflightStart(expectedRoomId, areaId, liveTitle);
      const requestHeaders = await getApiHeaders();
      const body = buildStartLiveBody(roomId, areaId, requireCsrf(), orientation);
      showMessage("正在获取推流码...");
      sent = true;
      // 在发送前持久化未知态，避免页面关闭后误以为请求未发生。
      saveLiveState(false, true);
      const result = await requestJson({
        method: "POST", url: API_URL_START_LIVE, headers: requestHeaders, data: body,
      }, false);
      GM_setValue("bili_last_start_response", result);
      saveLiveState(result.code === 0);
      if ([60024, 60028, 60043].includes(result.code) || result.data?.need_face_auth || result.data?.qr) {
        await handleFaceAuth(result);
      } else if (result.code === 0) {
        // 平台确认开播与地址解析是两个独立状态。
        await handleStartLiveSuccess(result.data, liveTitle, areaId);
      } else {
        showMessage(`开播失败：${businessMessage(result)}`, true);
        showServerNotice(result.data?.notice);
      }
    } catch (error) {
      if (sent && liveStatusUnknown) {
        const state = await checkActualLiveStatus(true);
        showMessage(`开播请求结果未知（${error.message}）；${state ? (isLiveStarted ? "房间已在直播，但未取得推流地址" : "查询时房间未开播，可手动重试") : "状态查询失败，请到官方直播中心确认"}。未自动重发请求。`, true);
      } else {
        showMessage(`${isLiveStarted ? "房间已开播，但获取推流地址失败" : "开播已停止"}：${error.message}`, true);
        if (sent) showServerNotice(GM_getValue("bili_last_start_response", null)?.data?.notice);
      }
    } finally {
      liveOperationPending = false;
      updateButtonsForLive(isLiveStarted);
    }
  }

  function businessMessage(result) {
    const messages = [...new Set([result.msg, result.message].filter((value) => typeof value === "string" && value))];
    return `${messages.join("；") || "未知错误"} (${result.code})`;
  }

  function officialUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password && (url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com"))) return url.href;
    } catch (_) {}
    return null;
  }

  function showServerNotice(notice, fallback = false) {
    const result = document.getElementById("bili-result");
    if (!result) return;
    if (notice?.title || notice?.msg) {
      const text = document.createElement("p");
      text.textContent = [notice.title, notice.msg].filter(Boolean).join("：");
      result.appendChild(text);
    }
    const url = officialUrl(notice?.button_url) || (fallback ? "https://link.bilibili.com/p/center/index" : null);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = notice?.button_text || "前往官方直播中心完成验证";
      result.appendChild(link);
    }
  }

  // 处理人脸验证
  async function handleFaceAuth(result) {
    showMessage(`平台要求身份验证：${businessMessage(result)}`, true);
    showServerNotice(result.data?.notice, true);
    const qrUrl = officialUrl(result.data?.qr);
    // 60043 的 voucher 由官方验证流程使用，不能伪装成 60024 轮询。
    if (result.code === 60043) {
      if (qrUrl) showQRCode(qrUrl);
      return;
    }
    if (!qrUrl) return;
    faceAuthCancelled = false;
    showQRCode(qrUrl);
    if (![60024, 60028].includes(result.code)) return;
    const deadline = Date.now() + 60000;
    try {
      while (!faceAuthCancelled && Date.now() < deadline) {
        const token = requireCsrf();
        const poll = await requestJson({
          method: "POST", url: API_URL_FACE_AUTH,
          data: serializeParams({ room_id: roomId, face_auth_code: String(result.code), csrf: token, csrf_token: token, visit_id: "" }),
        });
        if (faceAuthCancelled) return;
        if (poll.data?.is_identified === true || poll.data?.is_identified === 1) {
          hideQRCode();
          showMessage(isLiveStarted ? "身份验证已通过，平台已确认开播；请到官方中心检查推流信息" : "身份验证已通过，请再次点击开播；将重新预检并生成签名");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!faceAuthCancelled) showMessage("验证等待超时，请到官方直播中心确认后手动开播", true);
    } catch (error) {
      if (!faceAuthCancelled) showMessage(`身份验证状态查询失败：${error.message}`, true);
    } finally {
      hideQRCode();
    }
  }

  // 显示二维码
  function showQRCode(qrUrl) {
    // 移除已存在的二维码容器和遮罩
    const existingContainer = document.getElementById('bili-qr-container');
    const existingOverlay = document.getElementById('bili-qr-overlay');
    if (existingContainer) {
      existingContainer.remove();
    }
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'bili-qr-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // 创建二维码容器
    const qrContainer = document.createElement('div');
    qrContainer.id = 'bili-qr-container';
    qrContainer.style.cssText = `
      position: relative;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid #ddd;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      text-align: center;
      min-width: 300px;
      max-width: 90vw;
      max-height: 90vh;
    `;

    const title = document.createElement('h3');
    title.textContent = "身份验证";
    title.style.cssText = `
      margin: 0 0 15px 0;
      color: #fb7299;
      font-size: 18px;
      font-weight: bold;
    `;
    
    const instruction = document.createElement('p');
    instruction.textContent = "请使用 B 站客户端扫描官方二维码完成验证";
    instruction.style.cssText = `
      margin: 0 0 20px 0;
      color: #666;
      font-size: 14px;
    `;
    
    const qrDiv = document.createElement('div');
    qrDiv.id = 'bili-qr-code';
    qrDiv.style.cssText = `
      margin: 20px auto;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '取消';
    closeBtn.style.cssText = `
      background: #ff4b4b;
      color: white;
      border: none;
      border-radius: 5px;
      padding: 10px 20px;
      cursor: pointer;
      margin-top: 20px;
      font-size: 14px;
    `;
    closeBtn.onmouseover = () => closeBtn.style.background = '#d9363e';
    closeBtn.onmouseout = () => closeBtn.style.background = '#ff4b4b';
    closeBtn.onclick = () => {
      hideQRCode();
      showMessage("已取消人脸验证", true);
    };

    qrContainer.appendChild(title);
    qrContainer.appendChild(instruction);
    qrContainer.appendChild(qrDiv);
    qrContainer.appendChild(closeBtn);
    
    // 将二维码容器添加到遮罩层中
    overlay.appendChild(qrContainer);
    document.body.appendChild(overlay);
    
    // 点击遮罩层外部关闭二维码
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        hideQRCode();
        showMessage("已取消人脸验证", true);
      }
    });

    // 库不可用时仍提供同一官方链接，不泄露二维码凭据到控制台。
    try {
      if (typeof QRCode !== "undefined") new QRCode(qrDiv, { text: qrUrl, width: 200, height: 200 });
    } catch (_) {
      qrDiv.replaceChildren();
    }
    const link = document.createElement("a");
    link.href = qrUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "打开官方验证链接";
    qrContainer.insertBefore(link, closeBtn);
  }

  // 隐藏二维码
  function hideQRCode() {
    faceAuthCancelled = true;
    const qrContainer = document.getElementById('bili-qr-container');
    const qrOverlay = document.getElementById('bili-qr-overlay');
    if (qrContainer) {
      qrContainer.remove();
    }
    if (qrOverlay) {
      qrOverlay.remove();
    }
  }


  // 处理开始直播成功
  async function handleStartLiveSuccess(data, title, areaId) {
    showServerNotice(data?.notice);
    const { addr: rtmpAddr, code: rtmpCode } = await selectStream(data);
    const prevAddr = GM_getValue("bili_prev_rtmp_addr");
    const prevCode = GM_getValue("bili_prev_rtmp_code");
    streamInfo = { rtmpAddr, rtmpCode, roomId, areaId, title };
    GM_setValue(STORAGE_KEYS.STREAM_INFO, streamInfo);
    GM_setValue("bili_prev_rtmp_addr", rtmpAddr);
    GM_setValue("bili_prev_rtmp_code", rtmpCode);
    restoreStreamInfo();
    if (prevAddr && prevCode && (prevAddr !== rtmpAddr || prevCode !== rtmpCode)) {
      showMessage("推流信息已变动，请更新 OBS 等推流软件中的地址和推流码");
    } else {
      showMessage("平台已确认开播并取得推流码；尚未验证媒体连接或播放");
    }
    showServerNotice(data?.notice);
  }

  function usableStream(candidate) {
    return candidate && typeof candidate.addr === "string" && /^rtmps?:\/\/[^\s/]+\//.test(candidate.addr) &&
      typeof candidate.code === "string" && candidate.code.length > 0;
  }

  async function resolveNewLink(link) {
    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("不支持的调度 URL");
    // 保留原始 URL 的编码和凭据；匿名发送，不追加 appkey/sign。
    const response = await gmRequest({ method: "GET", url: link, anonymous: true, headers: await getApiHeaders() });
    if (response.status !== 200) throw new Error(`调度 HTTP ${response.status}`);
    let payload;
    try {
      payload = JSON.parse(response.responseText);
    } catch (_) {
      payload = response.responseText.trim();
    }
    if (typeof payload === "string" && /^rtmps?:\/\/[^\s]+$/.test(payload)) {
      const query = payload.indexOf("?");
      const slash = payload.lastIndexOf("/", query < 0 ? payload.length : query);
      const stream = { addr: payload.slice(0, slash + 1), code: payload.slice(slash + 1) };
      if (usableStream(stream)) return stream;
    }
    if (payload?.code !== undefined && typeof payload.code === "number" && payload.code !== 0) {
      throw new Error(`调度失败：${businessMessage(payload)}`);
    }
    const data = payload?.data ?? payload;
    const candidates = [...(Array.isArray(data?.protocols) ? data.protocols : []), data?.rtmp, data];
    const stream = candidates.find(usableStream);
    if (!stream) throw new Error("调度响应中没有可用 RTMP/RTMPS 地址");
    return stream;
  }

  async function selectStream(data) {
    const candidates = [...(Array.isArray(data?.protocols) ? data.protocols : []), data?.rtmp];
    const visited = new Set();
    let dispatchError;
    for (const candidate of candidates) {
      if (!candidate || (candidate.protocol && (typeof candidate.protocol !== "string" || !["rtmp", "rtmps"].includes(candidate.protocol.toLowerCase())))) continue;
      if (typeof candidate.new_link === "string" && candidate.new_link && !visited.has(candidate.new_link)) {
        visited.add(candidate.new_link);
        try {
          return await resolveNewLink(candidate.new_link);
        } catch (error) {
          dispatchError = error;
        }
      }
      if (usableStream(candidate)) return candidate;
    }
    throw new Error(dispatchError?.message || "服务端未返回可用 RTMP/RTMPS 地址（live_key 不是推流码）");
  }

  // 更新直播标题
  async function updateLiveTitle(roomId, title) {
    const token = requireCsrf();
    await requestJson({
      method: "POST", url: API_URL_UPDATE_ROOM,
      data: serializeParams({ room_id: roomId, platform: "pc_link", title, csrf: token, csrf_token: token }),
    });
    return true;
  }

  // 更新直播分区
  async function updateLiveArea(roomId, areaId) {
    const token = requireCsrf();
    await requestJson({
      method: "POST", url: API_URL_UPDATE_ROOM,
      data: serializeParams({ room_id: roomId, platform: "pc_link", area_id: areaId, csrf: token, csrf_token: token }),
    });
    return true;
  }

  // 停止直播
  async function stopLive() {
    if (liveOperationPending || !(isLiveStarted || liveStatusUnknown)) return;
    if (!confirm("确定要结束直播吗？")) return;
    liveOperationPending = true;
    updateButtonsForLive(isLiveStarted);
    let sent = false;
    try {
      const ownRoom = await getOwnRoom(roomId || String(GM_getValue(STORAGE_KEYS.LAST_ROOM_ID, "")));
      if (ownRoom.live_status !== 1) {
        saveLiveState(false);
        showMessage("服务器确认房间未开播");
        return;
      }
      const requestHeaders = await getApiHeaders();
      const body = buildStopLiveBody(roomId, requireCsrf());
      sent = true;
      saveLiveState(true, true);
      const result = await requestJson({ method: "POST", url: API_URL_STOP_LIVE, headers: requestHeaders, data: body }, false);
      saveLiveState(result.code !== 0, result.code === 0);
      const state = await checkActualLiveStatus(true);
      if (result.code !== 0) showMessage(`关播失败：${businessMessage(result)}`, true);
      else if (!state) showMessage("平台已确认关播，但状态读回失败；请重新打开面板查询", true);
      else showMessage(isLiveStarted ? "关播已受理，但房间仍在直播，请在官方中心确认" : "直播已结束，已读回服务器状态", isLiveStarted);
    } catch (error) {
      if (sent) await checkActualLiveStatus(true);
      showMessage(`${sent ? "关播请求结果未知，未自动重发" : "关播已停止"}：${error.message}`, true);
    } finally {
      liveOperationPending = false;
      updateButtonsForLive(isLiveStarted);
    }
  }

  // 显示消息（优化版：不覆盖推流信息）
  function showMessage(message, isError = false) {
    const resultArea = document.getElementById("bili-result");
    if (resultArea && isLiveStarted && streamInfo) {
      // 如果已开播，在推流信息区域内添加状态提示
      showStatusInStreamInfo(message, isError);
    } else if (resultArea) {
      // 未开播时，正常显示消息
      const text = document.createElement("p");
      text.className = `bili-message${isError ? " bili-message-error" : ""}`;
      text.textContent = message;
      resultArea.replaceChildren(text);
      resultArea.style.display = "block";
    }

    // 始终显示Toast通知
    GM_notification({
      text: message,
      title: isError ? "错误" : "B站推流码获取工具",
      timeout: 5000,
    });
  }

  // 在推流信息区域显示状态提示
  function showStatusInStreamInfo(message, isError = false) {
    const resultArea = document.getElementById("bili-result");
    if (!resultArea) return;

    // 查找或创建状态栏
    let statusBar = document.getElementById("bili-status-bar");
    if (!statusBar) {
      statusBar = document.createElement("div");
      statusBar.id = "bili-status-bar";
      statusBar.style.cssText = `
        margin-bottom: 10px;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 13px;
        text-align: center;
        transition: all 0.3s ease;
      `;
      // 将状态栏插入到推流信息的前面
      resultArea.insertBefore(statusBar, resultArea.firstChild);
    }

    // 设置状态栏样式和内容
    statusBar.className = isError ? "bili-status-error" : "bili-status-success";
    statusBar.textContent = message;
    statusBar.style.display = "block";

    // 3秒后自动隐藏状态栏
    clearTimeout(statusBar._hideTimer);
    statusBar._hideTimer = setTimeout(() => {
      if (statusBar) {
        statusBar.style.display = "none";
      }
    }, 3000);
  }

  // 复制到剪贴板
  function copyToClipboard(text) {
    GM_setClipboard(text);
    showMessage("已复制到剪贴板");
  }

  // 复制到剪贴板（按钮变✅，不弹窗）
  function copyToClipboardWithButton(text, btn) {
    GM_setClipboard(text);
    if (!btn) return;
    const oldText = btn.textContent;
    btn.textContent = "✅";
    btn.disabled = true;
    btn.classList.add("bili-copy-btn");
    setTimeout(() => {
      btn.textContent = oldText;
      btn.disabled = false;
      btn.classList.add("bili-copy-btn");
    }, 2000);
  }

  // 页面导航事件监听
  window.addEventListener("popstate", init);
  window.addEventListener("hashchange", init);

  // 监听页面可见性变化，页面可见时检查浮动按钮
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      checkFloatButton();
    }
  });

  // 使用MutationObserver监听DOM变化，动态检查浮动按钮
  const observer = new MutationObserver(function () {
    checkFloatButton();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 初始加载
  setTimeout(init, 500);
})();
