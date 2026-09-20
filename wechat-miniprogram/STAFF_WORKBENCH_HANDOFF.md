# 打手工作台原生适配（2026-09-17）

## 范围

只调整进入工作台后的原生小程序，后台业务与钱包账本不改。客户网页已于 2026-09-18 删除。
参考用户粘贴的《打手端-复刻提示词》；经用户同意，以原生组件适配，按钮统一橙色。
保留首页渐变、个人资料、五项状态统计、游戏分类列表、四列功能入口、五项底部导航。
不引入 uview/z-paging，不依赖原产品的图片服务器，也不展示第三方系统广告。

## 真实功能

- 入口仍是 `pages/mine` 的进入工作台，页面仍为 `pages/staff/index`。
- 首页昵称/数字 ID、游戏分类、接单数、各状态任务和未读数取现有接口。
- 接单大厅、我的订单、聊天、佣金提现、陪玩中心使用工作台内部导航，不影响老板端 tabBar。
- 状态和分类筛选、搜索、完整订单编号复制、详情面板。
- 接单、开始服务、上传结单截图及订单聊天沿用已有服务端接口和鉴权。
- 5 秒静默刷新，数据未变化不 setData；离开页面后忽略过期响应。
- 聊天支持轮询，发送失败保留草稿，关闭会话后忽略旧响应。
- 首页常驻切回老板按钮，同时保留身份选择弹窗。
- 预计分成只显示订单返回的 staffIncome/staffShare；零分成保持零，缺失显示待确认。

## 已接通：管事与邀请码（2026-09-17）

`components/staff-panel` 的「管事功能 / 我的下级」不再是占位：

- 打手在「管事功能」里输入后台发的升级码 → 兑换成功即成为管事，服务端同时自动发给他一张
  **长期有效**的「我的邀请码」（同一张码可反复邀请别人当他的下级）。
- 管事用「生成邀请码」拉人，别人兑换后成为他的下级打手，并同步出现在后台
  「陪玩管理 → 员工列表」里，带「邀请来源」列（管事昵称 + 数字 ID；商户直接开通的显示"商户开通"）。
- 提现手续费读后台配置 `withdrawFee`（2026-09-18 起，旧的 `stewardWithdrawFeeRate` /
  `stewardSelfWithdrawFeeEnabled` / `stewardSelfWithdrawFeeRate` 三个字段已删除）：
  打手提现先收一笔**总手续费**（`withdrawFee.staff`），这笔钱里管事按 `stewardShareRate`
  抽一部分（可按管事单独覆盖），剩下归商户；打手没有上级管事时整笔归商户。
  页面只显示打手自己付的总手续费（`withdrawFeeText`），管事/商户怎么分不对外展示。
  口径与继承规则见项目 `AGENTS.md` **§15**。
- 接口：`GET/POST /api/public/steward/:account[/redeem|/codes]`。
  联调真跑：`npm run verify:steward`（真服务端 + 真 MySQL，18 项）。

## 已接通：佣金提现（2026-09-18）

提现从工作台里搬出来做成**独立页** `pages/withdraw/index`；工作台只剩「可用佣金」一个真数字
＋跳转入口。原来内嵌在工作台里的 `withdraw` / `settlement` 两个模式已删除（有移除守卫钉着，
不许加回来），避免同一份金额/资料状态存两处、改一处忘一处。

钱的链路（四段，任何一段断掉都是「看得到钱、提不出来」，所以守卫一次盯全）：

- **结单入账**：商户结单时 `creditStaffWallet()` 把佣金打进「可用佣金」
  （`wallet_accounts` 里 `owner_type='staff'` 的那条），按 `(transaction_type, reference_no)`
  查重 —— 重复点结单 / 网络重试不会重复入账。
- **提交提现**：从可用佣金扣走生成 `pending` 提现单；**手续费在提交那一刻**由 `shared.js`
  解算并随分账一起冻结进单（之后商户改配置不影响已发出的单）。
- **审核通过 / 驳回**：驳回整笔原路退回，**按身份选钱包** —— 打手退打手钱包（`creditStaffWallet`），
  用户退客户余额（`creditCustomerWallet`）。两条路不共用：退错钱包等于把钱打进他的消费余额，
  他看得见但花不出去。
- **身份由服务端判**：打手提「可用佣金」；用户（客户）提自己的消费余额且**恒零手续费**。
  小程序只认服务端下发的 `identity`，不按本地条件自己推。
- ⚠️ **「我的」页（老板端）那一格「提现」已于 2026-09-18 按用户要求删除**（`mine/index.wxml`
  的 `<button bindtap="openWithdraw">` + `mine/index.js` 的 `openWithdraw()`）。
  提现现在**只**从打手工作台「可用佣金」进，客户身份不再有提现入口 —— 别加回来
  （移除守卫 + 两条负向用例见 `AGENTS.md` §17.5，代码里也留了注释说明去处）。

接口与后台：

- 小程序：`GET/POST /api/public/withdraw/:account[/records]`（进页配置 / 提交 / 我的提现记录）。
- 后台：`GET /api/withdraw-orders/:account`（列表）＋ `POST .../:orderNo/review`（通过/驳回）。
- 后台页面：「员工管理 → **提现审核**」（`admin.js` 的 `renderWithdrawAudit`）。
- 收款资料按渠道存**本地** Storage（`settlement_<渠道>`），提交时直接读，不另发请求。
- 每次进页（`onShow`）都重拉一次配置：最低提现额 / 开放渠道 / 说明文案都是商户后台随时可调的运营值。
- 渠道清单（key + label）在 `shared.js` 与 `miniprogram/utils/withdraw.js` 各一份，**逐字一致**
  （守卫直接 `require` 两份对比，少一个渠道或改一个字都会当场报错）。
- 手续费口径、继承规则、三张表见项目 `AGENTS.md` **§17**（管事接口见 §13）。

## 已接通：我的资金 / 罚单 / 佣金流水（2026-09-18）

按项目根目录的《资金指标开发提示词》落地。工作台「我的资金」那一屏现在是真数据：

- **8 格指标**（保证金 / 可用佣金 / 冻结佣金 / 累计结算 / 本月结算 / 上月结算 / 总已交罚款 / 待交罚款）
  全部是**服务端算好的最终值**下发，前端一行计算都没有 —— 不 SUM、不按月过滤，
  更不许拿 `累计 - 本月` 倒推上月（口径见项目 `AGENTS.md` §18.1 / §18.3）。
- 8 个金额格**全部走同一个 `money()`**（`utils/funds.js`），一格是整数也带两位小数。
  提示词点名的原版 bug 就是只给 2 个字段做 `toFixed`，同屏小数位不齐 —— 别再犯。
- **查不到就显示「—」**，绝不显示 `0.00`：打手会以为自己的钱真的少了。
- **保证金充值**：四档 10 / 20 / 50 / 100（20 推荐）+ 自定义金额，只增不减。
  ⚠️ **暂时不接真实支付**（用户 2026-09-18 定：整个项目要全面接入虚拟支付，先不做支付）：
  开发/本机环境直接入账并回 `mode: "direct"`，**生产环境一律 503 拒绝**。接虚拟支付时只换服务端那一段。
- **我的罚单**：三态筛选（全部 / 待缴纳 / 已缴纳 / 已撤销）+ 缴纳 + 分页（`limit` 固定 15，
  返回不足 15 条就是"没有更多了"）。`status` 是三态数字：`0` 待缴 / `1` 已缴 / **`>= 2` 一律已撤销**；
  只有待缴出「立即缴纳」按钮。**缴纳从「可用佣金」扣，不碰保证金**（三本账不许混）。
- **佣金流水**：收支方向只看 `amount_text` 是不是以 `-` 开头（**不靠 `type` 猜**），
  `amount_text` 原样输出、不再格式化。`完成解冻`那一类多显示商品名，`罚款`那一类多显示罚款理由。
- 时间字段全是服务端格式化好的字符串（`fine_time_text` / `pay_time_text` / `createtime_text`），
  前端不做任何 `new Date()`。
- 契约：小程序 `services/api.js` 的 `asContract()` 把本项目的 `{ ok }` 响应翻译成提示词的
  `{ code: 1, data }` 形态（**成功码是 1，不是 0**），所以页面可以完全照提示词写 `if (r.code !== 1)`。
- 身份只认会话令牌，客户端传上来的 `thug_id` 一律不看（服务端自己判有没有打手授权）。

接口与后台：

- 小程序：`GET /api/public/funds/:account`（8 格）、`POST .../bond`（保证金充值）、
  `GET /api/public/fines/:account`（罚单列表 + `unpaid_total`）、`POST .../pay`（缴纳）、
  `GET /api/public/commission-log/:account`（佣金流水）。
- 后台：`GET/POST /api/fines/:account`（列表 / 开单）、`POST .../:fineNo/revoke`（撤销）。
- 后台页面：「功能 → **罚单**」（`admin.js` 的 `renderFineModule`）。订单列表每行的「发罚单」
  **只在订单有接单打手时才出现**（罚单扣的是打手的可用佣金，没打手的订单开出来没人能缴）。
  ⚠️ 2026-09-18 之前它在「员工管理」下，用户要求把「罚单」和「保证金」一起挪进新组「功能」
  （原「消息中心」组改名而来），别再挪回去。「功能」组 = 罚单 / 保证金 / 系统公告。
  同组还有只读的「**保证金**」页（`renderBondModule`，读 `GET /api/bonds/:account`）——
  后台只能看、不能给打手充，钱只能由打手自己在小程序里充。
- 撤销只能撤**没缴**的：已缴的要先退钱，而本项目打手侧没有退款接口，硬撤会让打手看到「已撤销」
  但钱已经扣走 —— 所以服务端直接拦住，后台也不给已缴罚单渲染撤销按钮。
- 纯函数在 `miniprogram/utils/funds.js`（可在 Node 里直接 `require` 单测，见 `tests/funds.test.cjs`）。
  完整口径与守卫见项目 `AGENTS.md` **§18**。

## 仍未接通（不是完整业务交付）

`components/staff-panel` 的**陪玩等级信息**（我的服务评分 / 陪玩类型 / 陪玩等级 / 等级到期时间）
没有对应接口，仍显示「—」。等级、排行、平台客服与通知、接单开关和手机认证同样没有接口。

**资金相关的都已经接通**：8 格指标、保证金充值、罚单列表与缴纳、佣金流水（见上一节），
提现在 2026-09-18 接通为独立页。`余额明细` 那一屏头部三个数字和下面的流水都读服务端真实数据
（原来两块没有来源的「累计收入 / 累计提现」占位已整体换掉）。
不使用客户消费余额冒充佣金，不展示假零余额，不弹假成功，查不到就显示「—」。

录音调试页不属于本次工作台业务入口，未加入正式界面。

## 文件

- `miniprogram/pages/staff/index.{js,wxml,wxss,json}`：入口、交互与样式。
- `miniprogram/pages/staff/view-model.js`：订单映射、统计和筛选。
- `miniprogram/components/staff-panel/index.{js,wxml,wxss,json}`：原生布局 + 管事/邀请码/下级列表、
  我的资金 8 格、保证金充值、我的罚单、佣金流水（都是真实现），其余仍为未接通说明。
- `miniprogram/pages/staff/index.js` 的 `redeemSteward()` / `copyStewardCode()` / `generateStewardCode()` +
  `miniprogram/components/staff-panel/index.js` 的 `redeem` / `copycode` / `generate` 事件：管事链路。
- `tests/staff-workbench.test.cjs`：隔离测试，无真实订单/资金写入。
- `miniprogram/utils/funds.js`：**资金指标纯函数** —— `money()`（全项目唯一金额格式化）、
  `INDICATORS` / `indicatorList`（8 格）、`bondTierList` / `validateBondAmount`（保证金）、
  `fineStatusText` / `isFinePayable` / `fineRow` / `fineListEnded`（罚单三态与分页）、
  `commissionDirection` / `commissionRow` / `filterCommissionLog`（流水方向靠 `amount_text` 负号）。
  不依赖页面或组件实例，可直接在 Node 里 `require` 单测。
- `miniprogram/pages/withdraw/index.{js,wxml,wxss,json}`：**独立提现页**（进页配置 / 金额 / 收款资料 / 记录）。
- `miniprogram/utils/withdraw.js`：算钱公式 `calcWithdraw`、校验 `validateSubmit` / `validateSettlement`、
  渠道常量 `WITHDRAW_CHANNELS`（与根目录 `shared.js` 逐字一致）、`settlementKey`。
- `miniprogram/services/api.js` 的 `getWithdrawPage` / `submitWithdraw` / `asContract` /
  `thugMsg` / `thugBond` / `fineList` / `finePay` / `thugCommissionLog`；`app.json` 注册 `pages/withdraw/index`。
- 服务端 `server.js`：`creditStaffWallet` / `creditCustomerWallet`、`/api/public/withdraw/*`、
  `/api/withdraw-orders/*`、`staffFundIndicators` / `staffFrozenCommission` / `staffSettledTotals` /
  `staffFineTotals` / `rechargeStaffBond` / `listStaffFines` / `createStaffFine` / `revokeStaffFine` /
  `payStaffFine` / `staffCommissionLog`、`/api/public/funds/*`、`/api/public/fines/*`、
  `/api/public/commission-log/*`、`/api/fines/*`；
  `database.js` 的 `withdraw_orders`（含 `identity` 迁移块）与 `staff_fines`。
- 后台 `admin.js` 的 `renderWithdrawAudit()` + 「员工管理 → 提现审核」、
  `renderFineModule()` / `openFineDialog()` / `revokeFine()` + 「功能 → 罚单」、
  `renderBondModule()` / `loadStaffBonds()` + 「功能 → 保证金」（只读）。
- `tests/withdraw.test.cjs`：提现页专项（17 条，纯函数 + `vm` 真跑页面逻辑）。
- `tests/funds.test.cjs`：资金指标纯函数专项（`money` 统一格式化 / 8 格 / 「—」兜底 /
  保证金档位与校验 / 罚单三态与分页 / 流水方向与特殊类型）。
- 根目录 `scripts/check-production.js`：提现六条守卫 + **资金指标五条守卫**；
  `negative-test-assertions.json` 提现十条 + **资金指标十八条**对应负向用例。
  另有：常驻身份切换守卫改为整标签匹配；静默轮询负向用例适配新分支。不是取消守卫。

## 校验

在项目根目录运行 `npm run verify:all`、`npm test`、`npm run test:assertions`。
在 `wechat-miniprogram` 运行 `node --test tests/staff-workbench.test.cjs`。
管事链路真联调（真服务端 + 真 MySQL）：根目录 `npm run verify:steward`。
当前自动校验：小程序前置检查通过（10 个页面）；`check-all` 全绿
（含资金指标 5 条新守卫）；`npm test` 140/140；断言负向测试 119 条全 OK；管事联调 18/18。
实际模拟器检查尚未完成：已重新登录并编译，启动本地服务后首页恢复；仍需进入工作台逐页检查。
不把 Node 测试或基础源码检查作为真机布局验收。

小程序入口：用微信开发者工具导入 `wechat-miniprogram/`
本地后台：http://127.0.0.1:5180/admin.html
