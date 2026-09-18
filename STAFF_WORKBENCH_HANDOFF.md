# 打手工作台原生适配（2026-09-17）

## 范围

只调整进入工作台后的原生小程序，老板端页面、网页端、后台业务与钱包账本不改。
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

## 仍未接通（不是完整业务交付）

`components/staff-panel` 提供陪玩中心、佣金提现、提现资料、提现记录、余额明细、保证金充值、罚款、我的下级等布局/说明。
佣金、保证金、罚款、等级、排行、平台客服与通知、接单开关和手机认证没有对应接口，因此明确标注暂未接通。
不使用客户消费余额冒充佣金，不展示假零余额，不收集收款资料，不发起资金请求，不弹假成功。
录音调试页不属于本次工作台业务入口，未加入正式界面。

## 文件

- `miniprogram/pages/staff/index.{js,wxml,wxss,json}`：入口、交互与样式。
- `miniprogram/pages/staff/view-model.js`：订单映射、统计和筛选。
- `miniprogram/components/staff-panel/index.{js,wxml,wxss,json}`：原生布局 + 管事/邀请码/下级列表（真实现），
  其余仍为未接通说明。
- `miniprogram/pages/staff/index.js` 的 `redeemSteward()` / `copyStewardCode()` / `generateStewardCode()` +
  `miniprogram/components/staff-panel/index.js` 的 `redeem` / `copycode` / `generate` 事件：管事链路。
- `tests/staff-workbench.test.cjs`：隔离测试，无真实订单/资金写入。
- 根目录 `scripts/check-miniprogram.js` 与 `negative-test-assertions.json`：常驻身份切换守卫改为整标签匹配；静默轮询负向用例适配新分支。不是取消守卫。

## 校验

在项目根目录运行 `npm run verify:all`、`npm test`。
在 `wechat-miniprogram` 运行 `node --test tests/staff-workbench.test.cjs`。
管事链路真联调（真服务端 + 真 MySQL）：根目录 `npm run verify:steward`。
当前自动校验：全量三项通过；`npm test` 63/63；工作台测试 17/17；管事联调 18/18。
实际模拟器检查尚未完成：已重新登录并编译，启动本地服务后首页恢复；仍需进入工作台逐页检查。
不把 Node 测试或基础源码检查作为真机布局验收。

本地前台：http://127.0.0.1:5180/index.html?merchant=club001
本地后台：http://127.0.0.1:5180/admin.html
