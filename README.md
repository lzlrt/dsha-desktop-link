# dsh-desktop-link

在 **DeepSeek Harness（DSH）** 的侧栏底部加两个按钮：一个点一下就在系统浏览器 / 新标签页里打开**桌面版 DSH** 的 Web GUI，另一个（齿轮）用来**在界面里直接填地址**。

专门为 **DSHA（DeepSeek Harness 安卓启动器）** 设计 —— 在手机上的 DSHA 里点这个按钮，会交给系统浏览器打开你电脑上的 DSH，而 DSHA 自己那套 agent 照常独立运行。

```
🖥 →  桌面版      ⚙
```

[![npm](https://img.shields.io/npm/v/dsh-desktop-link?color=cb3837&logo=npm)](https://www.npmjs.com/package/dsh-desktop-link)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```sh
dsh plugin --profile web add dsh-desktop-link
```

---

## 它解决什么

DSHA 的内置浏览器只导航它自己的 `http://127.0.0.1:<端口>`，没有「填个网址去连别的机器」的入口。
但 DSHA 本来就有这条规则：**顶层导航离开本机 DSH 服务时，交给系统浏览器**（`WebPreviewActivity.shouldOverrideUrlLoading` → `ACTION_VIEW`）。

这个插件就是给这条已有规则加一个按钮入口 —— 不改 DSHA、不需要 root、不需要 `am start`。

---

## 行为

| 点击环境 | 结果 |
|---|---|
| **手机**（DSHA 的 WebView 或手机浏览器） | 导航离开 DSH 服务 → DSHA 交给系统浏览器 → 打开桌面版 GUI |
| **电脑浏览器** | `target="_blank"` 开新标签页，当前 GUI 不受影响 |

未配置地址时按钮变灰；此时点它会直接打开齿轮那个设置框，不会跳到一个死链。

---

## 安装

### 从 npm（推荐）

```sh
dsh plugin --profile web add dsh-desktop-link
```

### 从本仓库（开发循环）

```sh
git clone https://github.com/lzlrt/dsha-desktop-link
dsh plugin --profile web add link:$(pwd)/dsha-desktop-link
```

### 从打包好的 tgz

```sh
dsh plugin --profile web add /path/to/dsh-desktop-link-1.2.0.tgz
```

### 装到手机上的 DSHA

DSHA → 插件 → 添加 → 粘贴一个能下到这个包的 URL，例如：

```
https://registry.npmjs.org/dsh-desktop-link/-/dsh-desktop-link-1.2.0.tgz
```

或在 DSHA 插件页直接填包名 `dsh-desktop-link`。

或从本地导入（`adb push` 到 `/sdcard/Download/` 后在插件页选文件）。

装完在插件管理页点「重启 Web」。

---

## 配置地址

### 在界面上填（手机推荐）

点侧栏底部那个**齿轮** → 填两个框 → 保存。写盘、立即生效，不用重启、不用碰命令行。

```
┌─────────────────────────────┐
│ 桌面版地址                    │
│ 填一次就存在这台电脑上，手机和电脑都读同一份。 │
│ 当前生效（桌面地址文件）：https://…          │
│                             │
│ 桌面版地址                    │
│ [https://xxxx.dsh-market.com] │
│ 长期地址，留空则自动用固定中继。   │
│                             │
│ 点按钮时打开的地址              │
│ [https://…/open.html?k=…    ] │
│ 留空就等于上面的地址。          │
│                   [取消] [保存] │
└─────────────────────────────┘
```

保存会写进 `$DSH_HOME/desktop-url.txt`（先写临时文件再 rename，半个文件不会被读走）。
两个框都清空 = 删掉该文件，退回自动探测。

### 用配置文件

插件自身不带默认地址 —— 它从下面这些地方按顺序找，命中即停：

| 优先级 | 来源 |
|---|---|
| 1 | 本行 `config.desktopUrl` / `config.launchUrl`（profile 补丁里） |
| 2 | 环境变量 `DSH_DESKTOP_URL` / `DSH_DESKTOP_LAUNCH_URL` |
| 3 | `$DSH_HOME/desktop-url.txt` 第 1 行（桌面地址）/ 第 2 行（点击时打开的地址） |
| 4 | `$DSH_HOME/remote-web-ui-registry/web.json` 的 `id` → `https://<id>.dsh-market.com`（仅当装了 `dsh-remote-web-ui` 并开了固定域名中继） |

`desktop-url.txt` 是最好改的一个 —— **改完刷新页面即生效**，不用重启：

```text
# 第一行：桌面版长期地址（书签、复制链接用）
https://your-desktop.example.com

# 第二行（可选）：点按钮时真正打开的地址。
# 指向一个「每次铸新配对码」的端点，未配对的手机也能一次进。
https://your-desktop.example.com/pair-entry
```

只写一行 = 按钮直接开那一行。删掉文件 = 退回优先级 4。

### 两种地址的区别

| 字段 | 用途 |
|---|---|
| `desktopUrl` | 长期地址。锚点的 `href` 用它，中间键 / 复制链接 / 收藏都按这个走 |
| `launchUrl` | 点击时实际打开的地址。可以是一个会临时铸码的端点，让从未配对过的设备也能一次进入 |

没配 `launchUrl` 时它等于 `desktopUrl`。

---

## 未配对的手机会看到 401

DSH 的远程访问是要配对的。未配对设备直接打开桌面地址会被 harness 的认证栅栏拒绝 —— 这是配对机制正常工作，不是这个插件的 bug。

三种处理方式：

1. **先配对一次**：配对 cookie 默认有效期一年，之后点按钮直接进。
2. **配 `launchUrl` 指向铸码端点**：每次点击拿新码，永远有效。
3. **手机端自动铸码**：若本机装了 `dsh-remote-web-ui`，手机点击时插件会先调同源 `/api/pair/issue` 铸一枚一次性码再跳转（该接口只应答回环，所以页面能直接调）。没装则自动退回直接打开 `desktopUrl`。

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/desktop-link/info` | `{"ok":true,"launchUrl":"…","desktopUrl":"…","source":"…"}` |
| POST | `/api/desktop-link/config` | body `{"desktopUrl":"…","launchUrl":"…"}` → 写入 `desktop-url.txt`，返回写入后的解析结果与 `path` |

POST 只接受 `http(s)` URL：传了非空值但格式不对会返回 `400` 并说明原因，不会静默清空。
请求体上限 8 KiB，非 `POST` 返回 `405`。

每次请求重新解析地址，所以改配置文件不需要重启。
另外 Host 半区会在 `webserver/index-inject` 里注入 `globalThis.__DSHA_DESKTOP_LINK__`，让按钮首帧就能拿到地址；全局缺失时 Client 半区回退到上面那个接口。

---

## 结构

```
package.json          清单：dsh.bundle.patch + dsh.client(platform: web)
cordis.patch.yml      插入一行 dsha-desktop-link
index.js              Host 半区：地址解析 + /info + /config + index 全局
client.js             Client 半区：注册 sidebar.footer.action ×2 + 设置框
icon.svg              显示器 + 外跳箭头
locale/{zh,en}.json   meta.title / meta.description
```

### 实现要点

- 注册 `sidebar.footer.action` 两次（`replaceRisk: none`）：启动按钮 `order: 10`，齿轮 `order: 11`，都排在官方「远程访问」之后。
- 设置框跟齿轮挂在同一棵组件树里（`position: fixed` 覆盖层），不额外 `createRoot` —— 这样不依赖 `react-dom/client` 是否在页面可 require 的白名单里。
- 两个按钮之间的状态用一个模块级 store 同步，保存完另一个立刻拿到新地址，不用刷新。
- `Config` 导出是**可选**的：`@deepseek-ai/schemastery` 只存在于 DSH 安装内部，运行时按包名 → `process.argv[1]` 上溯 → Node 全局路径依次找；找不到就整个不导出 `Config`，插件照常工作，只是没有 DSH 自带的设置表单。
- 手机与电脑的分支靠 `navigator.userAgent` 判定；桌面侧完全走原生锚点行为，不拦点击。

---

## 已知限制

1. **Host 半区（`index.js`）改动需要重装插件或重启 `dsh web`**；Client 半区（`client.js`）刷新页面即生效（有 `pnpm run dev:web` 监听时可免刷新）。
2. 侧栏折叠成 56px 轨道时只显示图标，展开后才显示「桌面版」文字。
3. 手机端「点击时铸码」依赖本机装了 `dsh-remote-web-ui`（本插件不声明这个依赖，装不装都能用，只是没有自动铸码）。
4. 需要 DSH `>= 0.2.1-rc.2`（`webserver/index-inject` 事件与 `sidebar.footer.action` 槽位）。

---

## License

MIT
