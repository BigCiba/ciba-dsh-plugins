# ciba-dsh-plugins

个人使用的 DSH（DeepSeek Harness）插件合集。每个 `packages/<name>` 是一个独立的 bundle 包，可以单独安装、单独启停。

## 插件

| 包 | 功能 |
|---|---|
| [`@local/account-balance`](packages/account-balance) | 在侧边栏账号入口正上方显示 DeepSeek 账号余额；点击立即刷新，页面可见时每 3 分钟自动刷新，窗口重新获得焦点时也会刷新。 |
| [`@local/side-chat`](packages/side-chat) | 从当前会话派生一个独立的侧边会话，在右侧边栏继续，不打断主线。 |

## 在另一台电脑安装

打开 DSH 侧边栏的 **Plugins**，点 **Add plugin**，填入对应包的 spec：

```text
git+https://github.com/BigCiba/ciba-dsh-plugins.git#<commit>&path:/packages/account-balance
git+https://github.com/BigCiba/ciba-dsh-plugins.git#<commit>&path:/packages/side-chat
```

- **`&path:/packages/<name>` 这一段不能省略**：仓库根目录不是插件包，省略后装到的是根目录，DSH 会报“这个包没有声明组合包，不能作为插件管理”。
- `<commit>` 换成 40 位完整 commit SHA；在本仓库执行 `git rev-parse HEAD` 即可得到。
- 用完整 commit 安装时，插件页才会把 Git 来源标记为可更新（配合插件索引）；直接写 `#main` 也能装，但以后只能移除再重装。
- 公开仓库可以直接安装；私有仓库需要先在这台机器上配好 Git 凭据（HTTPS 凭据管理器或 SSH）。
- 安装后的包默认启用；插件行开关与配置在插件页里调整。
- 两台机器的 DSH 版本尽量保持一致：这些插件按 DSH 0.2.2-rc.5 的 Client 扩展点（slot、`accountUi` 服务）编写。

## 本机开发

开发机上这两个包以 `link:` 方式安装，指向本仓库的 `packages/<name>`。改完代码后让插件入口重启（插件页里关闭再打开，或重启应用）即可生效。

这两个包没有构建步骤，`client.js` 就是最终产物；可以用 `pnpm pack` 检查实际打包内容：

```powershell
pnpm --dir packages/account-balance pack --pack-destination out
```

## 新增插件

1. 复制一个现有包作为起点，或在 `packages/<name>/` 下按 bundle 结构创建：
   - `package.json`：声明 `dsh.bundle.patch`；有 Web UI 时再加 `dsh.client`
   - `cordis.patch.yml`：插入插件行
   - `index.js`：Host 半（无逻辑时导出空 `apply`）
   - `client.js`：Client 半（`window.__ModuleLoader__.load`）
   - `locale/*.json`、`icon.svg`、`README.md`
2. 在本机 **Plugins → Add plugin → 本地目录** 安装验证。
3. 提交后，在上面的安装说明里补一行对应 spec。

## 常见报错

- **“这个包没有声明组合包，不能作为插件管理”**：装到的是仓库根目录（或别的没有 `dsh.bundle` 的包），不是 `packages/<name>`。检查 spec 末尾是否保留了 `&path:/packages/account-balance` / `&path:/packages/side-chat`；也不要只填仓库网页地址。
- **安装后看不到插件**：确认它出现在 **Plugins → 已安装插件** 里且开关是开的；Client 插件需要页面刷新或重启应用才会出现在界面上。

## 说明

- 包名使用 `@local/*`，不发布到 npm，只通过 Git 安装或本地链接使用。
- 账号登录、API key 等凭据不包含在这些包里；换机器后需要各自登录/配置。
