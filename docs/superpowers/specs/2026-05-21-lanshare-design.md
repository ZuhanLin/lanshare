# lanshare - 局域网文件共享 CLI 设计文档

**日期**：2026-05-21
**状态**：已批准，待实现

## 背景

参考 `python3 -m http.server` 的工作原理：在 Mac/Win 上启动一个 HTTP 服务，让同一局域网的手机/平板等设备通过 IP:Port 访问共享目录。痛点是用户需要手动查本机 IP、手动在另一台设备上输入地址。

本项目做一个终端 CLI 工具（类似 Claude Code 的形态），启动后自动：
- 起 HTTP 服务暴露指定目录
- 显示二维码，其它设备扫码直达
- 在终端实时展示请求日志

## 目标与非目标

**目标（MVP 范围）**：
- 只读的目录浏览与文件下载
- ASCII 二维码渲染在终端
- 自动选择本机 LAN IP、自动避让被占端口
- Ink TUI 实时展示访问日志

**非目标（明确不做）**：
- 手机端上传文件到电脑
- 访问鉴权 / 密码 / 一次性链接
- HTTPS / 证书
- 网卡变化时热重载
- 跨子网 / 内网穿透

## 技术栈

- **语言**：TypeScript
- **运行时**：Node.js (ESM)
- **TUI**：Ink + React
- **HTTP**：Node 原生 `http` + `serve-handler`
- **二维码**：`qrcode-terminal`
- **CLI 参数**：`commander`
- **构建**：tsup（输出单文件 ESM bin）
- **测试**：vitest
- **分发**：npm 包，支持 `npx lanshare`

## 架构

### 模块划分

| 模块 | 路径 | 职责 |
|---|---|---|
| CLI 入口 | `src/cli.ts` | 参数解析、校验、引导启动 |
| HTTP 服务 | `src/server.ts` | 基于 serve-handler 的静态服务，EventEmitter 暴露 `request`/`error`/`listening` |
| 网络枚举 | `src/network.ts` | 列出本机非回环 IPv4 地址，按优先级排序 |
| 端口探测 | `src/port.ts` | 从起始端口递增探测可用端口 |
| 二维码 | `src/qr.ts` | URL → ASCII 二维码字符串 |
| TUI 根 | `src/ui/App.tsx` | Ink 根组件，组合子组件并订阅 server 事件 |
| Header | `src/ui/Header.tsx` | 显示共享路径、监听地址、状态 |
| QRPanel | `src/ui/QRPanel.tsx` | 二维码 + 主 URL + 备用 URL 列表 |
| Logs | `src/ui/Logs.tsx` | 最近 20 条请求日志（环形截断） |
| Footer | `src/ui/Footer.tsx` | 退出提示 |

### 数据流

```
cli.ts
  ↓ 解析 + 校验
  ↓ 调 network/port 决定 host + port
  ↓ new Server(dir, host, port).listen()
  ↓ render(<App server />)

server (EventEmitter)
  ─emit('request', entry)→  Logs (useState 追加)
  ─emit('error', err)─────→  Logs (红色)
```

## CLI 接口

```
lanshare [dir] [options]

参数：
  dir                  共享目录路径（默认：当前工作目录）

选项：
  -p, --port <number>  起始端口，默认 8000，被占自动 +1
  -h, --host <ip>      绑定的本机 IP（多网卡手动指定）
  --no-qr              不渲染二维码（非 TTY 或脚本场景）
  --help               帮助
  --version            版本
```

### 启动期校验（fail-fast，stderr + exit 1）

| 条件 | 错误信息 |
|---|---|
| 目录不存在 / 不是 directory / 不可读 | `Error: directory '<path>' does not exist or is not readable` |
| 起始端口 + 100 都被占 | `Error: no free port available in range <start>-<start+100>` |
| `--host` 不是本机网卡 IP | `Error: <ip> is not a local interface; available: <list>` |
| 找不到任何非回环 IPv4 | `Error: no LAN interface found; are you connected to a network?` |

## HTTP 服务行为

- **方法**：仅 `GET` / `HEAD`，其它返回 `405 Method Not Allowed`
- **绑定**：监听 `0.0.0.0`（不限制具体网卡），二维码 URL 用首选 IP
- **路径安全**：serve-handler 自动防止 `..` 穿越（限制在共享目录内）
- **目录请求**：返回 HTML 目录列表（serve-handler 默认样式，手机浏览器友好）
- **文件请求**：流式返回 + `Content-Disposition: inline`，支持 `Range`（视频可拖动进度）
- **请求事件**：每次请求 emit 一条
  ```ts
  { time: Date, method: string, path: string, status: number, ip: string, bytes: number }
  ```

## 端口探测

伪代码：
```
port = startPort
while port <= startPort + 100:
  try: listen(port); return port
  catch EADDRINUSE: port += 1
throw "no free port"
```

任何非 `EADDRINUSE` 的 listen 错误直接抛出。

## 网络地址解析

`getLanAddresses()` 枚举 `os.networkInterfaces()`，过滤：
- `family === 'IPv4'`
- `internal === false`
- 不在 `169.254.0.0/16`（link-local）

返回 `Array<{ iface: string, address: string }>`。

**优先级排序**：`192.168.*` > `10.*` > `172.16-31.*` > 其它。

**首选地址**：排序后取第一个；用户传 `--host` 时优先用户值（但必须在枚举结果中，否则报错）。

**备用地址**：所有候选都在 TUI 中列出，方便用户切网络时一眼看到备用 URL。

## 二维码渲染

- 用 `qrcode-terminal` 的 `small: true` 模式（半块字符 ▀，主流终端兼容）
- 内容：首选地址的完整 URL，如 `http://192.168.1.10:8000/`
- 非 TTY 或 `--no-qr` 时跳过渲染，但仍打印 URL

## TUI 布局

```
┌─ lanshare ────────────────────────────────┐
│ 📂 /Users/me/Downloads                     │
│ 🟢 Listening on http://192.168.1.10:8000   │
├────────────────────────────────────────────┤
│                                            │
│   █▀▀▀▀▀█ ▄▀ █▀▀▀▀▀█                       │
│   █ ███ █ ▀▄  █ ███ █     扫码访问         │
│   █▄▄▄▄▄█ ▀ ▄ █▄▄▄▄▄█                      │
│                                            │
│   备用地址:                                │
│     http://10.0.0.5:8000  (en1)            │
│                                            │
├─ Recent requests ──────────────────────────┤
│ 14:32:05  GET  /            200  192.168.1.20 │
│ 14:32:07  GET  /photo.jpg   206  192.168.1.20 │
│ 14:32:09  GET  /video.mp4   206  192.168.1.20 │
├────────────────────────────────────────────┤
│ Ctrl+C 退出                                │
└────────────────────────────────────────────┘
```

### 状态管理

- React `useState` + `useEffect` 订阅 server EventEmitter
- Logs 维护一个长度上限 20 的数组
- 不引入额外状态库

### 退出处理

- Ink `useInput` 捕获 `Ctrl+C` 和 `q` 键
- 调用 `server.close()` 优雅关闭
- 关闭前给 1 秒宽限期让活跃连接结束，超时则 `server.closeAllConnections()` 强制关
- 最后 `process.exit(0)`

## 错误处理

### 启动期
fail-fast 见上文 CLI 校验表，stderr 输出 + `exit 1`。

### 运行期
- 单个请求处理异常：在 Logs 显示一行红色错误，不影响其它请求
- 网卡变化：MVP 不处理，由用户手动重启
- server `'error'` 事件（非请求级）：渲染到 Logs 顶部 banner

## 项目结构

```
local-service/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
├── src/
│   ├── cli.ts              # 入口 (#!/usr/bin/env node)
│   ├── server.ts
│   ├── network.ts
│   ├── port.ts
│   ├── qr.ts
│   └── ui/
│       ├── App.tsx
│       ├── Header.tsx
│       ├── QRPanel.tsx
│       ├── Logs.tsx
│       └── Footer.tsx
└── test/
    ├── network.test.ts
    ├── port.test.ts
    ├── server.test.ts
    └── qr.test.ts
```

### package.json 关键字段

```json
{
  "name": "lanshare",
  "type": "module",
  "bin": { "lanshare": "./dist/cli.js" },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli.ts",
    "test": "vitest run"
  }
}
```

### 依赖

**runtime**：`ink`, `react`, `serve-handler`, `qrcode-terminal`, `commander`

**dev**：`typescript`, `tsx`, `tsup`, `vitest`, `@types/node`, `@types/react`

## 测试策略

| 模块 | 测试要点 |
|---|---|
| `network.ts` | mock `os.networkInterfaces()`，验证 IPv4/内网/link-local 过滤与优先级排序 |
| `port.ts` | 真实 listen 占住端口，验证递增找到下一个空闲端口；占满 100 个验证抛错 |
| `server.ts` | 启动 server，curl 模拟 GET 文件 / 目录 / 404 / 405 / Range，验证响应 + emit 事件 |
| `qr.ts` | 给定 URL 输出非空字符串即可，不解码二维码 |
| `cli.ts` | 集成测试：fork 子进程跑 CLI，传不存在目录验证 exit 1 |

UI 组件不写单测（Ink 测试 ROI 低），手动验证。

## 验证标准

- `npm run dev` 启动后能在终端看到二维码与首选 URL
- 手机连同一 WIFI 扫码能访问目录列表、能下载/预览文件
- 8000 被占时自动用 8001（用真实 server 占住验证）
- 不存在的目录给出清晰错误并 exit 1
- `Ctrl+C` 干净退出，无僵尸进程
- 视频文件请求带 `Range` header 返回 206

## 决定记录

- **方案 A 单进程**而非 worker_threads：MVP 文件传输属 IO 密集，不会卡 UI，worker 隔离的收益不抵复杂度
- **绑定 0.0.0.0** 而非首选 IP：避免多网卡环境踩坑，二维码 URL 才用首选 IP
- **MVP 不做上传/鉴权**：YAGNI，等真实使用反馈再迭代
- **不写 UI 单测**：Ink 组件测试基础设施成本高于收益，靠手动验证
