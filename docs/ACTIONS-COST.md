# COST-001 — GitHub Actions 零支出整改计划

状态：原降低 Actions 存储方案已被用户暂停，改为停用全部 Actions、撤下托管附件、只保留源码。远端清理已完成；0.3.0 本地 UI ZIP 导入已实现，见 SOURCE-ONLY.md。

## 现行规则与已核对状态

- 仓库 HunkYuan/opencode-vscode 为 public，使用 ubuntu-latest／windows-latest 标准 GitHub-hosted runners。
- GitHub 当前规则对公开仓库标准 runner 的运行时间免费；larger runners 仍会收费。
- 账号为 GitHub Free，Actions artifact 免费存储额度为 500 MB，和 GitHub Packages 共享；cache 独立额度为每仓库 10 GB。
- 当前仓库有 28 个未过期 Actions artifacts，总计 1,137,744,414 bytes（约 1.06 GiB），默认保留 90 天。
- 当前 cache 74,665,036 bytes，2 项；核对时无进行中的 workflow run。
- 用户截图 Billed amount 为零。Gross amount 是减免前用量折算，当前高于容量不能单独推导已扣费，但若持续保留产物可能形成超额计费。
- storage 按 GB-hours 累积；删除产物减少后续占用，不抹除已累积的用量。

## 零支出策略

1. 保持公开仓库，使用标准 runners。
2. 用户个人账号的 Actions 产品预算设为 $0，并启用 Stop usage when budget limit is reached；必须核对预算 scope 覆盖整个账号，避免仅提醒不拦截。
3. 若账号没有有效支付方式，GitHub 文档说明超出额度后会阻止继续用量；不新增支付方式作为零付费优先策略。
4. 正式 VSIX/UI 包继续放 GitHub Releases；Actions artifact 只用于 job 之间临时传递和短期失败诊断。
5. 普通 CI 不重复上传 VSIX 和 UI ZIP；临时产物保留 1 天，发布确认成功后清理此次发布传递用产物。
6. 收费或额度限制时允许自动更新暂停，不切换到付费 runner、不提高预算、不删已公开 Release 资产。
7. 不承诺未来 GitHub 定价不变；以账号计费硬限制和最少临时存储控制风险。

## 修改清单

| 位置 | 计划修改 |
|---|---|
| .github/workflows/ci.yml | 普通 CI 保留验证，减少无用途的大型重复 artifact 上传 |
| .github/workflows/ui-validation.yml | 临时传递及诊断产物设 1 天 retention，保留发布所需的 job 传递 |
| .github/workflows/ui-release.yml、ui-upstream.yml | 成功发布并校验后清理此次 workflow 的传递产物；失败时短期保留诊断 |
| 新增清理脚本／workflow（实际必要时） | 仅操作本仓库已完成 run 的 artifact，在上传／清理前核对库存 |
| docs/WORKLOG.md、docs/ACTIONS-COST.md | 记录费用约束、操作范围、验证结果 |
| GitHub Actions artifacts | 删除已完成 runs 的 28 份旧构建产物；保留所有 Release 资产及源码 |
| GitHub 个人账号 Billing → Budgets and alerts | Actions 产品 $0 硬预算；该设置未完成前不能宣称零费用保护已生效 |

远端 artifact 删除不可恢复，需要用户明确同意；正式发行文件已有独立的 GitHub Release 副本。当前没有进行中任务，所以没有需要继续传递的 artifact。

GitHub 公开 REST budgets 文档目前列出的预算管理端点面向组织。此个人账号预算需要在 GitHub Billing 页面确认设置；不通过未公开端点或猜测请求修改支付信息。新增硬预算只限制建立之后的用量，旧累计用量仍需在账单中核对。

## 官方资料

- [GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)：公开仓库标准 runners 免费；artifact 与 cache 额度、存储计费及无支付方式时的限制。
- [设置预算](https://docs.github.com/en/billing/how-tos/set-up-budgets)：产品级预算与 Stop usage when budget limit is reached；不勾选只告警。
- [预算规则](https://docs.github.com/en/billing/concepts/budgets-and-alerts)：新预算只计算创建后用量。
- [删除 Actions 产物](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts)：默认 90 天保留，删除不可恢复。

## 验证与交付

- 清理前再次核对只涉及本仓库 Actions artifacts，且不影响进行中 run 或 Releases。
- 清理后回读 artifact 库存及总大小。
- 检查 workflow 所需传递产物仍可完成下载和发布；避免为重复检查创建大型 artifact。
- 回读账号硬预算设置或由用户在 Billing 页确认，单独说明无法核对的账户状态。

## 用户调整后的执行结果 — 2026-10-24

- 用户明确选择停用全部 Actions，并授权助手删除 Release 附件；不再沿用临时产物保留 1 天的原方案。
- 仓库 Actions 已整体禁用，四个 workflow 均停用；没有进行中的任务。
- 五个 Release 的十二个附件、二十八份 Actions artifacts 和两项缓存全部删除；源码、标签、Release 文字和历史保留。
- Actions artifacts 与 cache 均回读为零，旧 stable.json 更新清单清空，避免旧客户端继续下载不存在的资产。
- 用户回复确认 Actions 产品 $0 预算与 Stop usage when budget limit is reached 已设置；这是用户确认，个人预算未通过 API 回读。
- 源码模式与本地导入计划见 [SOURCE-ONLY.md](SOURCE-ONLY.md)。当前远端产物已撤下，现有安装的 0.2.0 应关闭 uiAutoUpdate。

0.3.0 已移除源码中的 Actions 定义及在线下载／发布入口。本机编译与 ZIP 导入替代远端构建和资产分发；后续源码提交不执行 Actions，也不上传 Release 产物。
