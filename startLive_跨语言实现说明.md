# startLive 跨语言实现说明

更新日期：2026-10-12。适用样本：Livehime **8.8.0.11119**。

本文整理普通开播 **startLive** 接口的完整请求契约，供 Go、Java、C#、JavaScript、Rust、C/C++ 等语言实现。HTTP 路径使用大小写准确的 `/room/v1/Room/startLive`。

依据为本地 DLL 静态分析、既有签名函数模拟结果，以及当前 Python／OBS 插件实现。固定常量绑定此客户端构建；历史横屏请求组合已真实成功，本文没有重新验证当前线上规则，也没有逐字段验证服务端的强制性。本文的“固定发送”指复现此实现所需的字段。

## 1. 请求概览

| 项目 | 内容 |
|---|---|
| 方法 | `POST` |
| 完整 URL | `https://api.live.bilibili.com/room/v1/Room/startLive` |
| 请求正文 | `application/x-www-form-urlencoded`，按本文规则序列化得到的 ASCII 字节 |
| 参数位置 | 全部开播参数与 `sign` 放入 POST 正文，当前构造器不另加 URL query |
| 登录方式 | 官方网页登录取得的有效 Cookie；此路线表单保留空 `access_key` |
| 普通默认请求 | 11 个签名输入字段，加上 `sign`，共 12 个表单字段 |
| `buvid` | 独立 HTTP 请求头；不参与 `sign` |

实现顺序：取得登录态和设备标识 → 查询本人房间／选择分区 → 开播前检查 → 生成时间戳和表单 → 签名 → 序列化正文 → 发送一次 → 解析业务结果。

## 2. 调用者需要提供的信息

| 信息 | 获取方式与用途 |
|---|---|
| 有效登录 Cookie | 官方网页登录交付；当前实现要求核心 `SESSDATA`、`bili_jct`，并保留其余适用 Cookie 的域、路径、安全属性和有效期 |
| CSRF 值 | 从同一登录会话的 `bili_jct` 取值，分别填入 `csrf`、`csrf_token` |
| 本人房间 ID | 先用 nav 得到当前账号 `mid`，以 `uId=<mid>` 查询 GetInfo，读取 `data.room_id` |
| 二级分区 ID | 沿用房间的 `area_v2_id`，或从 GetAreaListForLive 的二级子项 `id` 选择 |
| 直播方向 | 普通横屏／竖屏，分别映射为 `type=2`／`type=1` |
| 原生设备 `buvid` | 初始化一次并持久化，详见第 4 节 |
| 当前 Unix 秒 | 即将发送前获取；不是毫秒时间戳 |

当前网页登录路线无需先取得旧 OAuth 的 App access token。网页 refresh token 也不能填入 `access_key`。非空 access_key 的编码向量仅用于核对签名算法，不表示旧 OAuth 路线已实测。

## 3. POST 表单字段

### 3.1 普通默认分支

表中所有值在签名和序列化前均为**字符串**；ID 与时间戳使用不带小数、科学计数法、分组符号的十进制格式。

| 字段 | 值／来源 | 默认发送 | 参加签名 |
|---|---|---|---|
| `appkey` | `aae92bc66f3edfab` | 是 | 是 |
| `platform` | `pc_link` | 是 | 是 |
| `version` | `8.8.0.11119` | 是 | 是 |
| `build` | `11119` | 是 | 是 |
| `ts` | 当前 Unix 秒，转十进制字符串 | 是 | 是 |
| `access_key` | Cookie 登录下为空字符串 `""` | 是，保留 `access_key=` | 是 |
| `room_id` | 当前登录账号自己的房间 ID，正整数 | 是 | 是 |
| `area_v2` | 二级分区 ID，正整数 | 是 | 是 |
| `type` | 普通横屏 `"2"`；普通竖屏 `"1"` | 是 | 是 |
| `csrf` | Cookie 的 `bili_jct` 原始值 | 是 | 是 |
| `csrf_token` | 与 `csrf` 完全相同 | 是 | 是 |
| `sign` | 32 个小写十六进制字符 | 计算后加入 | 不参加自身签名 |

`area_v2` 不使用父分区 ID，也不使用目录中的 `old_area_id`。UID 用于查询房间，默认 startLive 表单没有 UID 字段。标题和封面是服务器已有的房间设置，默认 startLive 表单也没有 `title`／`cover` 字段。

`type` 不是 RTMP／RTMPS 的协议开关。2／1 是此构建普通横竖屏分支的映射；原客户端 `custom-rtmp` 特殊开关会强制 `type=1`，双屏还有其他参数，不能把它推广为所有分支通用的方向枚举。当前 OBS 插件按实际输出尺寸判断方向：高大于宽为竖屏，否则横屏。

### 3.2 原客户端的条件参数

以下参数默认省略。若对应分支需要发送，必须先加入待签名集合，再计算 `sign`；省略与发送空字符串会产生不同签名。

| 字段 | 原客户端条件／格式 | 当前普通实现 |
|---|---|---|
| `src`、`checked` | 输入 checked 为 0 时一起发送；`src` 为输入整数的十进制字符串，`checked="0"` | Python 指定 `--src N` 才发送；OBS 省略 |
| `recommend_ip`、`recommend_protocol` | 有推荐 IP 和配套推荐协议时一起发送；另有只发送非空回退推荐协议的分支 | 未做测速／配置选择，省略 |
| `multi_screen_type`、`multi_screen_info` | 双屏分支输入为 1 时加入；信息内容由双屏配置生产 | 未实现，省略 |
| `xcode_suffixes` | 非空转码后缀列表，按逗号连接后作为一个字符串 | 未实现，省略 |

原客户端 AnchorInfo 默认 `src=-1`、`checked=1`，因此默认请求**两项均不发送**，也不发送 `checked=1`。`checked=0` 不能解释成跳过实名认证／风控。

另一个备流／付费业务开播重载会加入 `backup_stream`、`backup_stream_type`、`stream_biz`。本文的可复现默认契约不实现该重载；双屏信息、特殊业务值和推荐协议的完整取值范围尚未闭环，不应凭字段名填入示例值。

## 4. HTTP 请求头与 buvid

| 请求头 | 当前实现值／来源 | 参加表单签名 |
|---|---|---|
| `Content-Type` | `application/x-www-form-urlencoded` | 否 |
| `Cookie` | 适用于目标 HTTPS URL 的有效登录 Cookie | 否 |
| `buvid` | 持久化原生设备 ID | 否 |
| `User-Agent` | `LiveHime/8.8.0.11119 os/Windows pc_app/livehime build/11119 osVer/10_0` | 否 |
| `Referer` | `https://live.bilibili.com/` | 否 |
| `Accept` | `application/json` | 否 |
| `client_traceid` | 原客户端有非空追踪值时添加，当前实现省略 | 否 |

UA 是当前 API 层沿用的兼容配置，不表示实际宿主一定运行 Windows。`Host`、正文长度等传输字段由 HTTP 客户端按 URL 和实际正文处理。

原生 `buvid` 的初始化流程：

1. 优先读取有效持久化值；存在就直接复用。
2. 无缓存时，匿名 GET `https://data.bilibili.com/gv`，无账号 Cookie、表单签名、业务参数，也不带待获取的 `buvid`。
3. HTTP 200 时直接使用响应正文，不按 JSON 解析。当前实现验证长度为 1～4096，且所有字符均在 ASCII 33～126 范围；不自动 trim 或改写标识。
4. HTTP／传输失败时，生成 `lowercase_uuid_v4 + decimal_process_id + "user"`，然后持久化。
5. 返回内容格式异常、用户取消或已有缓存损坏时，报错停止；不把这些情况当作网络失败去生成替代值。

本地回退示例，均为虚构输入：

```text
UUID = 12345678-1234-4abc-8abc-123456789abc
PID  = 12345
buvid = 12345678-1234-4abc-8abc-123456789abc12345user
```

UUID 保留连字符、不含花括号；UUID 与 PID、PID 与 `user` 之间没有额外分隔符。这里没有硬件序列号、MAC 地址或 MD5。保存后即使重启、PID 改变或重新登录，也继续复用旧值。

Python 默认保存于 `.state/device.json`，OBS 当前保存于插件 `config.json` 的 `device.buvid`，同时记录来源；文件权限为 0600。历史设备请求曾返回 404，本地回退生成的标识与修正后的横屏参数组合已成功开播。

`buvid` 与 Cookie 中的 `buvid3` 分开管理，不直接互相替换。它由统一 API 发送层注入，因此账号、房间、分区、预检、开关播和 `new_link` 调度也可以携带同一个头；调度仍使用不带账号 Cookie 的独立客户端。WebKit 页面不经过这个统一 API 层。

## 5. 精确编码与签名算法

### 5.1 字符串与排序

- 参数是单值的 `string -> string` 映射；默认字段名全部为 ASCII。拒绝重复键，避免语言容器对重复字段产生不同解释。
- 本移植契约拒绝空键、键／值中的 NUL，以及非字符串值。空字符串值允许，尤其不能删除空 `access_key`。
- 字符串按 UTF-8 编码；不做 Unicode normalization，不做预解码，也不把已有 `%XX` 当作编码结果。
- **先按原始键的 UTF-8 字节序排序，再分别编码键和值。** 比较使用无符号字节的词典序；不要用本地化／忽略大小写的比较器，也不要按编码后的键排序。

默认 11 个签名输入的顺序为：

```text
access_key, appkey, area_v2, build, csrf, csrf_token, platform, room_id, ts, type, version
```

### 5.2 Percent encoding

只保留下列 ASCII 字节，其余字节逐个转换为 `%HH`，其中 `HH` 使用大写十六进制：

```text
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!'()*-._~
```

| 原始输入 | 编码结果 |
|---|---|
| 空格 | `%20` |
| `+` | `%2B` |
| `%` | `%25` |
| `&` | `%26` |
| `=` | `%3D` |
| `/` | `%2F` |
| `!'()*-._~` | 原样保留 |
| `中` | `%E4%B8%AD` |
| 原始字符串 `%2F` | `%252F` |
| `é`（U+00E9） | `%C3%A9` |
| `e` + U+0301 | `e%CC%81`，与上一项不同 |

用 `encoded_key + "=" + encoded_value` 构造每一项，再用 `&` 连接。末尾没有 `&`、换行、空格或 NUL。空值仍产生 `key=`。不要依赖默认 form encoder 的空格处理或安全字符集合；先对照第 8 节向量。

### 5.3 MD5 输入

固定盐为：

```text
af125a0d5279fd576c1b4418a3e8276d
```

这是 **32 字节 ASCII 文本**，不能把它按十六进制解码成 16 字节。

```text
S = serialize(parameters_without_sign)
md5_input = ASCII_BYTES(S) || ASCII_BYTES(salt)
sign = LOWERCASE_HEX(MD5(md5_input))
```

`||` 表示直接拼接：不加 `&`、`=`、分隔符或换行。MD5 产生 16 字节，再转成恰好 32 个小写十六进制字符。不是 HMAC-MD5，也不是先对 S 求摘要后再拼盐。

### 5.4 最终正文

算出 sign 后，将其作为新字段加入映射，再按相同规则完整序列化：

```text
P = common_fields + business_fields + csrf_fields + optional_fields
assert "sign" not in P
digest = lowercase_hex(md5(ascii(serialize(P)) + ascii(salt)))
Q = copy(P)
Q["sign"] = digest
body_bytes = ascii(serialize(Q))
POST(endpoint, headers, raw_body=body_bytes)
```

**开播的 `csrf`、`csrf_token` 在签名前加入。** HTTP 头、完整 URL、方法名、Host、Content-Type、Cookie、buvid 都不进入 MD5 输入。当前 startLive 没有“签名后才加入的业务字段”；sign 自身除外。

签名后不要再更改 `ts`、方向、分区、CSRF 或任何条件表单字段。需要改值时，重新计算签名和正文。正文以已构造的原始字节交给 HTTP 库，避免库再次转义或重新按另一套规则编码。

## 6. 独立参考实现（只构造正文）

下面的 Python 代码只依赖标准库，用逐字节实现展示算法，不依赖本仓库模块，也不发送网络请求。其他语言照此实现 byte encoder、排序和 MD5 即可。

```python
import hashlib

SALT = b"af125a0d5279fd576c1b4418a3e8276d"
SAFE_BYTES = set(
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!'()*-._~"
)


def percent_encode(text):
    return "".join(
        chr(byte) if byte in SAFE_BYTES else f"%{byte:02X}"
        for byte in text.encode("utf-8")
    )


def serialize(params):
    for key, value in params.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise TypeError("All parameter keys and values must be strings")
        if not key or "\0" in key or "\0" in value:
            raise ValueError("Empty keys and NUL are unsupported")
    keys = sorted(params, key=lambda key: key.encode("utf-8"))
    return "&".join(
        percent_encode(key) + "=" + percent_encode(params[key])
        for key in keys
    )


def calculate_sign(params):
    if "sign" in params:
        raise ValueError("sign cannot be included in its own input")
    return hashlib.md5(serialize(params).encode("ascii") + SALT).hexdigest()


def make_start_body(room_id, area_id, csrf, ts,
                    orientation="landscape", access_key="", src=None):
    for label, value in (("room_id", room_id), ("area_id", area_id), ("ts", ts)):
        if type(value) is not int or value <= 0:
            raise ValueError(label + " must be a positive integer")
    types = {"landscape": "2", "portrait": "1"}
    if orientation not in types:
        raise ValueError("Unsupported orientation")
    params = {
        "appkey": "aae92bc66f3edfab",
        "platform": "pc_link",
        "version": "8.8.0.11119",
        "build": "11119",
        "ts": str(ts),
        "access_key": access_key,
        "room_id": str(room_id),
        "area_v2": str(area_id),
        "type": types[orientation],
        "csrf": csrf,
        "csrf_token": csrf,
    }
    if src is not None:
        if type(src) is not int:
            raise ValueError("src must be an integer")
        params.update(src=str(src), checked="0")
    params["sign"] = calculate_sign(params)
    return serialize(params).encode("ascii")


# 固定离线输入：用于核对正文；真实请求应使用当前 Unix 秒和有效登录态。
body = make_start_body(123, 456, "EXAMPLE_CSRF", 1700000000)
assert b"sign=c187040363c754fbfb428dc1017c4261" in body
print(body.decode("ascii"))
```

传入函数前，真实发送流程还需检查 Cookie 有效性、csrf 非空且与 Cookie 一致、房间归属及开播前条件。上面的固定输入只是算法向量。

## 7. 完整 HTTP 形状示例

下面所有账号／设备值均为虚构，`ts=1700000000` 是固定离线时间戳。真实请求必须替换凭据和时间戳并重新签名。正文实际只有一行，换行仅用于分隔 HTTP 头和正文。

```http
POST /room/v1/Room/startLive HTTP/1.1
Host: api.live.bilibili.com
Content-Type: application/x-www-form-urlencoded
User-Agent: LiveHime/8.8.0.11119 os/Windows pc_app/livehime build/11119 osVer/10_0
Referer: https://live.bilibili.com/
Accept: application/json
Cookie: SESSDATA=EXAMPLE_SESSDATA; bili_jct=EXAMPLE_CSRF
buvid: 12345678-1234-4abc-8abc-123456789abc12345user

access_key=&appkey=aae92bc66f3edfab&area_v2=456&build=11119&csrf=EXAMPLE_CSRF&csrf_token=EXAMPLE_CSRF&platform=pc_link&room_id=123&sign=c187040363c754fbfb428dc1017c4261&ts=1700000000&type=2&version=8.8.0.11119
```

## 8. 固定测试向量

机器可读文件：[vectors.json](evidence/startlive-contract-20261012/vectors.json)。它包含每组参数、签名原文、完整 MD5 输入、期望 sign，以及四组 startLive 的最终 POST 正文。

这些是 2026-10-12 以虚构输入离线计算的向量，不是新的原客户端抓包或真实开播结果。逐字节编码器已与原客户端转义位图的 255 个非 NUL 字节核对；结果还与现有 Python 构造器对照，并复核了既有的 9 组原签名函数模拟向量。

### 8.1 普通横屏完整向量

输入：room_id=123，area_v2=456，ts=1700000000，双 CSRF 均为 EXAMPLE_CSRF，type=2，access_key 为空；不发送 src／checked。

签名前序列化结果：

```text
access_key=&appkey=aae92bc66f3edfab&area_v2=456&build=11119&csrf=EXAMPLE_CSRF&csrf_token=EXAMPLE_CSRF&platform=pc_link&room_id=123&ts=1700000000&type=2&version=8.8.0.11119
```

MD5 实际输入（盐紧接最后一个字符）：

```text
access_key=&appkey=aae92bc66f3edfab&area_v2=456&build=11119&csrf=EXAMPLE_CSRF&csrf_token=EXAMPLE_CSRF&platform=pc_link&room_id=123&ts=1700000000&type=2&version=8.8.0.11119af125a0d5279fd576c1b4418a3e8276d
```

期望 sign：

```text
c187040363c754fbfb428dc1017c4261
```

最终正文见第 7 节，或 JSON 中的 `expected_body`。比较时不包括代码块自带的行末换行。

### 8.2 四组完整开播向量

| 向量名称 | 期望 sign |
|---|---|
| `landscape_default` | `c187040363c754fbfb428dc1017c4261` |
| `portrait` | `a8948ab4de10b3f70a6898554fea8fce` |
| `landscape_src_7` | `91624da5b22e66c1e8471aeadcd0bcd6` |
| `escaping_with_fake_token` | `4a5aa9a2e72e96c76e4404b404f67b72` |

后三组分别只改变方向、增加 `src=7&checked=0`，以及使用含空格／加号／百分号／中文的虚构 token 与 CSRF。最后一组只验证编码算法，不证明这类 token 值可用于线上认证。

### 8.3 四组独立序列化向量

| 向量名称 | 期望 sign |
|---|---|
| `empty_parameters` | `b4128d99822aa96e502be595c55baa93` |
| `punctuation_empty_unicode` | `a2bcce5fcd060f68a908e0c099a9aa76` |
| `raw_utf8_key_order` | `e149710425ec146a1d0c1e6a8144ae16` |
| `no_unicode_normalization` | `8dfa4f50560d0e7eb28d3d38f60f74e2` |

它们分别检查空集合加盐、特殊字符与空值、按原始 UTF-8 键排序，以及不做 Unicode normalization。这里的参数集合用于测序列化器，不代表合法 startLive 请求。

推荐先逐项比较 `serialized_before_sign`，再比较 `expected_sign`，最后比较 `expected_body`。更换 `buvid`／UA／Referer 时，表单不变就应得到相同 sign；更换任一双 CSRF 或 `type` 时则必须重新签名。

## 9. 开播前检查的最小配套信息

若其他语言也实现完整调用链，可按以下表复现配套接口。定义：

```text
A = {appkey, platform, ts}
L = A + {version, build, access_key}
C = {csrf, csrf_token}
```

这些接口采用第 5 节同一编码／MD5 算法，但签名输入与追加时机各不相同。GET 的最终参数放在 URL query，POST 放在正文。

| 顺序／目的 | 方法与路径 | 签名输入 | 签名后追加 |
|---|---|---|---|
| 确认登录，取得 mid | GET `https://api.bilibili.com/x/web-interface/nav` | A | 无 |
| 查询本人房间 | GET `https://api.live.bilibili.com/xlive/app-blink/v1/room/GetInfo` | L + `uId=<mid>`，大小写准确 | 无 |
| 查询分区目录 | GET `https://api.live.bilibili.com/xlive/app-blink/v1/preLive/GetAreaListForLive` | L + `current_area_id`；首次无当前分区时可为 0 | 无 |
| 检查实名认证 | GET `https://api.live.bilibili.com/xlive/app-blink/v1/preLive/PreCheck` | A | C |
| 检查标题／封面 | GET `https://api.live.bilibili.com/xlive/app-blink/v1/preLive/PreLive` | L | 下文所列标志 |

PreLive 签名后追加：

```text
mobi_app=pc_link
cover=true
area=true
title=true
schedule=true
coverVertical=true
liveDirectionType=0
```

这些布尔标志是小写字符串 `"true"`。`title=true` 表示查询标题信息。此构建 PreLive 固定 `liveDirectionType=0`，即便准备竖屏开播也保留 0。

当前实现确认 nav 的 `isLogin=true` 和 `mid`，GetInfo 的房间归属、非正在直播及非锁定状态，PreCheck 的 `realname_status=1`，以及 PreLive 的 `cover_title_start_live_intercept.need_intercept=false`，然后才发送 startLive。分区目录用于选择或确认 area_v2，不一定在每次开播时重新请求。

## 10. 响应、错误与状态处理

HTTP 200 只代表传输层收到回复；必须解析 JSON 并检查顶层业务 `code`。错误文本可能使用 `msg` 或 `message`，应保留服务器原文及未知 code。

| 字段／情况 | 用途与处理 |
|---|---|
| 顶层 `code=0` | 记录平台已确认开播；取得可用媒体地址仍是后续步骤 |
| `data.need_face_auth`、`data.qr` | 额外身份验证要求及官方 QR URL |
| `code=60043` | 独立风控认证分支，即使 need_face_auth=false 也可能要求处理 |
| `data.risk_extra.v_voucher` | 60043 官方身份验证流程的服务端 voucher |
| `data.notice` | 服务端提示／按钮字段，按实际返回处理 |
| `data.live_key`、`data.sub_session_key` | 本场状态／业务标识，不能替换媒体推流码 |
| `data.rtmp` | 可能含 `addr`、`code`、`new_link` |
| `data.protocols[]` | 按服务端／原客户端顺序保留多协议候选；可能先需要查询 new_link |
| `data.protocols_backup[]`、`data.xcode_stream[]` | 备流／转码相关列表，默认调用者应保留原始响应 |

60024／60028 还有各自的人脸认证分支。基础实名认证通过不代表本次开播一定无需额外验证。认证同步得到的 `x-bili-gaia-vtoken` 是条件性的 Cookie，不是固定表单参数；历史修正组合已有无 Gaia Cookie 的开播成功记录。

发送后超时、网络中断或回复不可解析时，记录结果未知并查询房间状态，不自动重发 startLive。如果顶层已明确 code=0，后续地址选择失败也不能把房间当作未开播。开播成功与媒体连接成功、平台接收、观众播放是不同状态。

`new_link` 是后续调度 URL，完整保留其已有编码／凭据，不另追加 appkey／sign 公共参数；当前实现使用不带账号 Cookie、但带 UA 和原生 buvid 的独立 GET 客户端。完整选择／失败回退逻辑见主报告和现有 stream_selection 实现。

关播为 POST `https://api.live.bilibili.com/room/v1/Room/stopLive`：先签 `L + room_id`，再追加 C；双 CSRF 不进入这次关播签名。关播结果也要单独检查 code，并读回房间状态。不要把开播的签名字段集合直接复制给关播。

## 11. 常见移植错误

| 错误 | 正确做法 |
|---|---|
| 删除空 access_key | 保留 `access_key=` |
| 先签六项公共字段，再加开播业务字段 | startLive 在加入业务字段和双 CSRF 后签名 |
| 把 buvid／Cookie／URL 放进 MD5 | 只签本文规定的表单字段 |
| 把盐 hex-decode 为 16 字节 | 拼接 32 字节 ASCII 盐文本 |
| 空格转 `+` 或编码额外安全字符 | 使用第 5 节精确字节规则 |
| 将已有 `%2F` 直接透传 | 原始值 `%2F` 应编码为 `%252F` |
| 使用本地化排序或先编码再排序 | 按原始 UTF-8 键的无符号字节排序 |
| 修改签名后表单，或再次自动 form encode | 重签后直接发送最终 ASCII 正文 |
| 将 ts 写成毫秒／浮点／科学计数法 | 当前 Unix 秒的十进制字符串 |
| 默认发 checked=1 | 默认 src／checked 均省略 |
| 用父分区或 old_area_id 填 area_v2 | 使用二级分区 id |
| 固定所有普通开播 type=1 | 普通横屏 2、竖屏 1 |
| HTTP 200 就宣布成功 | 检查可解析 JSON 和业务 code |

## 12. 证据与实现入口

- [主分析报告](Livehime_8.8.0.11119_接口与原型.md)：样本 SHA-256、签名、原客户端条件分支与历史验证边界。
- [Python 编码／签名／请求构造](../bililive_proto/protocol.py)：`encode`、`sign`、`make_request`。
- [Python 请求头及正文发送](../bililive_proto/client.py)：`Client`。
- [设备生成与验证](../bililive_proto/device.py)，[初始化流程](../bililive_proto/cli.py)。
- [OBS 请求构造及统一发送层](../obs-plugin/src/common/platform_api.cpp)，[构建常量](../obs-plugin/src/common/client_profile.h)。
- [原客户端序列化函数](evidence/secret/0x180026930.json)，[转义位图](evidence/secret/escape-wrapper.json)。
- [原客户端普通开播构造器](evidence/secret/0x18013e270.json)，[AnchorInfo 默认值](evidence/secret/anchor-getters.json)。
- [既有原签名函数模拟向量](evidence/sign-vectors.json)：9 组加盐 MD5 结果及压缩块。
- [横屏修正组合历史成功记录](evidence/risk-audit/live-corrected-start-stop-chain.json)：type=2、原生 buvid、无 Gaia Cookie，开播／关播及状态读回。
- [本说明的跨语言固定向量](evidence/startlive-contract-20261012/vectors.json)：4 组开播和 4 组独立序列化向量。

验证边界：普通横屏组合有历史真实 API 成功证据；竖屏、条件 src 的线上行为以及双屏／备流特殊分支不由本文的离线向量证明。既有媒体测试也不能当作本次新实现的媒体验收。

