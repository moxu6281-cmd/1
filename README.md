# 电竞俱乐部多商户系统

本项目保留原生微信小程序、商户后台、总管理员、多商户隔离、商品、订单、打手分成和 MySQL 数据层。客户网页版已移除。

## 角色与地址

- 总管理员：创建、修改或停用商户子管理员，可管理全部商户。
- 商户子管理员：账号密码登录，只能配置自己的俱乐部、商品和订单。
- 小程序前端：导入 `wechat-miniprogram/`，通过配置的商户账号读取已发布数据。
- 本地后台：`http://127.0.0.1:5180/admin.html`

总管理员登录后台后，打开“员工管理 > 管理员列表”，填写俱乐部名称、商户账号和初始密码，即可生成商户子管理员。商户仍使用同一个后台网址登录，服务端按账号隔离数据，不需要为每个商户复制一套后台。

## 本地运行

要求 Node.js 24+ 和 MySQL 8.0+。数据库、连接和页面统一使用 UTF-8/`utf8mb4`。

### Windows 一键准备（推荐）

首次在一台新电脑运行时，双击 `setup-local.cmd`。它会：

1. 检查 Node.js 与 npm。
2. 从 MySQL 官方地址下载便携版 MySQL 8.4（约 280 MB），无需传统安装程序。
3. 创建本机 `.env`、安装 Node 依赖并执行源码检查。

准备完成后：

- 双击 `start-local.cmd`：初始化 MySQL、创建数据库账号并启动 Node 服务。
- 双击 `stop-local.cmd`：停止本项目启动的 Node 与 MySQL。
- 小程序：用微信开发者工具导入 `wechat-miniprogram/`。
- 后台：`http://127.0.0.1:5180/admin.html`
- 健康检查：`http://127.0.0.1:5180/api/health`

`tools/`、`.env`、数据库文件、日志和 `node_modules/` 不进入源码包。给另一台电脑部署时，在那台电脑重新运行 `setup-local.cmd`。

需要重新生成干净源码压缩包时执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-source.ps1
```

### 手工准备

1. 将 `.env.example` 复制为 `.env`，修改总管理员和 MySQL 密码。
2. 在 MySQL 中创建数据库和最小权限账号：

```sql
CREATE DATABASE esports_club CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'club_app'@'127.0.0.1' IDENTIFIED BY '请替换成高强度数据库密码';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON esports_club.* TO 'club_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

3. 安装依赖并启动：

```powershell
npm ci
npm run check
npm start
```

从旧 SQLite 版本升级时只执行一次 `npm run migrate:mysql`。日常备份执行 `npm run backup`，备份文件会写入 `data/backups/`，其中含账号哈希和会话信息，必须妥善保管。

## 发布规则

- 商品新增、修改、上下架：在商品弹窗点击保存后立即写入 MySQL，并同步小程序。
- 公告、轮播、每排商品数等其他配置：先保存在浏览器草稿，点击右上角“保存并关联前端”后才正式发布。
- 小程序读取公开接口，不读取后台浏览器的草稿，因此刷新或换设备也能保持一致。

## 商业服务器部署

推荐使用一台 Linux 云服务器、MySQL 8、Node.js、Nginx、域名和 HTTPS。宝塔不是必须的，它只是图形化管理 Nginx、MySQL 和进程的工具；熟悉命令行可直接部署。

生产环境必须做到：

1. `ADMIN_PASSWORD` 与 `DB_PASSWORD` 使用不同的 12 位以上高强度密码。
2. MySQL 只监听内网或本机，禁止向公网开放 3306。
3. Nginx 反向代理 Node 端口，只向公网开放 HTTPS 443。
4. 用 PM2、systemd 或 Docker 保持 Node 服务常驻。
5. 定时运行 `npm run backup`，并将备份复制到另一台服务器或对象存储。

Docker 部署时先在 `.env` 配置 `ADMIN_PASSWORD`、`DB_PASSWORD`、`MYSQL_ROOT_PASSWORD`，然后执行：

```bash
docker compose up -d --build
```

`docker-compose.yml` 会同时启动 MySQL 8.4 和应用，并使用持久化数据卷。

## 微信小程序说明

原生微信小程序前端放在 `wechat-miniprogram/`，可直接导入微信开发者工具。当前包含首页、分类、商品详情、提交订单、订单状态和“我的”，复用现有 Node API、MySQL、多商户和后台配置。

本地导入与正式上线条件见 `wechat-miniprogram/README.md` 和 `微信小程序部署前提.md`。微信登录、微信支付、对象存储、微信客服等仍需正式 AppID、服务器域名或商户号后再真实对接，待对接项见 `对接.md`。
