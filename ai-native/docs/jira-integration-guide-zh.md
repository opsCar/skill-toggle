# JIRA 集成指南

> 维护说明：本文档需要与英文版 `jira-integration-guide.md` 同步维护。

## 概览

AI-Native JIRA 集成会在 INTAKE、SPEC、IMPLEMENT、LEARN 阶段通过 DevHelper 传输通道读写 JIRA。repo-init 默认优先使用 **DevHelper MCP**，本地 DevHelper `helper` CLI 只作为 fallback。已关联 Jira 时，SPEC 写回是阻塞项；其他写回是提示性操作，失败时记录告警但不阻塞阶段完成。

## 前置条件

1. Host 中优先启用 DevHelper MCP；agent 调用 MCP 前必须先查看对应 tool schema。
2. DevHelper `helper` CLI 建议安装在 `${HOME}/.local/bin/helper`，用于 fallback 或 MCP 未暴露的能力。
3. Jira connector 已完成认证；如果 CLI 认证失效，运行：
   ```bash
   ${HOME}/.local/bin/helper auth jira
   ```
4. 使用 CLI fallback 时，验证 connector 可用：
   ```bash
   ${HOME}/.local/bin/helper connector jira JIRA_GET_CURRENT_USER
   ```
   退出码为 `0` 即表示可用。不要依赖 grep 某个固定字段（例如 `accountId`），DevHelper 不同版本的输出结构可能不同。

## 默认行为

repo-init 模板默认开启 JIRA 集成：

```yaml
jira_integration:
  enabled: true
  project_key: "ZOOM"
  transport_preference:
    - mcp
    - helper_cli
  create_issue:
    issue_type: "Task"
    summary_format: "{task_type}: {short_summary}"
    engineering_task_description:
      enabled: true
      rendering: jira_safe_plain_text
      required_questions:
        - "What is the problem? State the problem you are trying to solve."
        - "What is the root cause? Describe what is the root cause of the problem."
        - "Success criteria (DoD) What are the criteria to measure the success of the solution."
        - "How does it Impacts the user experiences? If user experiences is impacted, please work with PM and review with UE/UX."
        - "Additional Information: List monitoring, logging, controls, dependencies and other related information."
    additional_properties:
      zoom_module:
        field_key: "customfield_13244" # Zoom Module
        value: "Build System"
      platform_os:
        field_key: "customfield_14917" # Platform OS
        inference: ai
        default: "All"
        allowed_values: ["All", "Mac", "Windows", "Linux", "visionOS", "Android", "iOS", "iPadOS"]
      task_type:
        field_key: "customfield_12821" # Task Type
        inference: ai
        default: "Technical Enhancement"
        allowed_values: ["New Feature", "UX Enhancement", "Security Enhancement", "Technical Enhancement", "Feature Release Control"]
  require_jira: true
  writeback:
    intake: true
    spec: true
    implement: true
    learn: true
  release_policy_path: "ai-native/rules/release-policy.yaml"
```

因此新 run 创建前，orchestrator 必须先询问用户：

- 使用已有 JIRA issue key
- 创建新的 JIRA issue
- 显式跳过 JIRA

如果仓库不属于 `ZOOM` 项目，请把 `project_key` 改成对应项目 key。ZOOM starter 默认使用已验证的 `Task` 创建字段 ID：`customfield_13244` 对应 Zoom Module，`customfield_14917` 对应 Platform OS，`customfield_12821` 对应 Task Type。

`transport_preference` 按顺序选择 Jira 传输方式。`mcp` 表示 DevHelper MCP Jira tools，例如 `jira_create_issue`、`jira_get_issue`、`jira_add_comment`、`jira_get_transitions`、`jira_transition_issue`。`helper_cli` 表示 `${HOME}/.local/bin/helper connector jira ...`。不要使用浏览器自动化作为 Jira fallback。如果当前 host 的 MCP 没有暴露字段编辑能力，agent 会再尝试 `helper_cli`；如果没有任何可写通道，则记录告警并且不做 Jira 状态流转。

用户选择新建 Jira 时，agent 按下面规则补齐默认字段：

- `Zoom Module`：使用配置值，默认 `Build System`。
- `Platform OS`：根据需求和仓库范围由 AI 推断；非 OS 专属改动默认 `All`。
- `Task Type`：根据需求意图由 AI 推断；默认 `Technical Enhancement`。

对于 engineering-driven task，agent 会按 `summary_format` 生成单行 summary，并在 Jira description 中写入五个标准问题的回答，然后附上原始需求。Description 必须使用纯文本标签和 hyphen bullets，不使用 Markdown 标题、Markdown 表格、blockquote 或有序列表形式的段落标题，避免 Jira/ADF 渲染出重复的 `1.` / `a.` 前缀。

## Run 命名

当用户提供或创建 JIRA issue 后，orchestrator 会把 key 传给 `start_run.py`：

```bash
SKILL_ROOT=$(python3 -c "import os,sys; [print(c) or sys.exit(0) for c in [os.path.expanduser('~/.codex/skills/ai-process-core'),os.path.expanduser('~/.cursor/skills/ai-process-core')] if os.path.isdir(c)]")
python3 "$SKILL_ROOT/scripts/ai_process/start_run.py" \
  --request "<raw request>" \
  --jira-issue-key "ZOOM-134325" \
  --actor-type agent
```

运行目录会使用 JIRA key，例如：
`ai-native/runtime/ai-process/runs/RUN-ZOOM-134325-20260519093000/`。

如果 `require_jira: false` 且用户选择 `skip`，或者 JIRA 被禁用/不可用，run 会回退到请求摘要生成的 slug 或 hash。repo-init 默认 `require_jira: true`，此时必须拿到已有或新建 JIRA key 后才能启动 run。

## 各阶段行为

### INTAKE

- 读取已有 JIRA：MCP `jira_get_issue` 或 CLI `JIRA_GET_ISSUE`
- 新建 JIRA：MCP `jira_create_issue` 或 CLI `JIRA_CREATE_ISSUE`
- 写入 intent 摘要评论：MCP `jira_add_comment` 或 CLI `JIRA_ADD_COMMENT`
- 尝试流转到 `In Progress`：MCP `jira_get_transitions` + `jira_transition_issue`，或 CLI `JIRA_TRANSITION_ISSUE`

issue key 会保存到 `run-state.json → jira_issue_key`，供后续阶段使用。

当 `require_jira: true` 时，用户提供的已有 Jira key 在本地格式校验通过后即可启动 run，即使 agent sandbox 里没有可用 Jira transport。只有需要 agent 新建 Jira 或从 Jira 字段补充 intent 上下文时，才需要可用 transport。

### SPEC

- 必须调用确定性脚本：`python3 ai-native/scripts/ai_process/writeback_jira_spec.py --run-id <RUN_ID>`
- 原始 Description 过短时，脚本通过 CLI `JIRA_EDIT_ISSUE` 回填 Description 字段；内容使用 Jira-safe plain text，不使用 Markdown 标题或有序列表段落标题
- `customfield_12712`（Technical Design Spec）不由 AI-Native SPEC writeback 修改
- 脚本回填 Risk Analysis 字段：`customfield_15634`、`customfield_15635`、`customfield_15636`、`customfield_15637`、`customfield_15638`、`customfield_15639`、`customfield_15886`、`customfield_17370`、`customfield_25604`
- 脚本保留或写入 Security Owner 字段 `customfield_12892`，这是 ZOOM 安全评审流转 validator 要求
- 字段回填成功后通过 CLI `JIRA_GET_TRANSITIONS` + `JIRA_TRANSITION_ISSUE` 流转到 `Ready for Security Review`；如果 issue 仍在 `Open`，脚本会先执行配置的前置 `Open` → `In Progress` 流转，然后重新查询并执行安全评审流转

当已关联 Jira 且 `jira_integration.writeback.spec: true` 时，SPEC gate 会要求 run history 中存在 `jira_spec_writeback_succeeded`。如果脚本没成功，本地流程不能继续进入后续阶段。

如果本地 helper CLI 因 DevHelper vault/keychain 锁定而不可用，host 可以改用具备写能力的 DevHelper MCP Jira tools。MCP 路径必须完成同样的字段更新（但不修改 Technical Design Spec）、audit comment 和状态流转，并确认 Jira 上字段/状态正确后，再调用 `writeback_jira_spec.py --record-external-success --transport mcp` 记录 gate evidence。不要在 Jira 写回真正成功前记录 external success；SPEC gate 会要求成功事件里包含配置的目标状态。

### IMPLEMENT

- 根据任务标注或启发式估算，通过 MCP `jira_add_comment` 或 CLI `JIRA_ADD_COMMENT` 写入时间估算评论
- 不自动修改 JIRA 状态，状态流转由开发者负责

### LEARN

- 读取 fix version 并执行 release checkpoint / CC 判断
- 通过 MCP `jira_add_comment` 或 CLI `JIRA_ADD_COMMENT` 写入 MR checklist 和 reviewer 建议

## 故障排查

| 现象 | 常见原因 | 处理 |
|------|----------|------|
| 没有询问是否关联 JIRA | `jira_integration.enabled` 为 `false` | 改为 `true` |
| 选择 `new` 失败 | `project_key` 为空或错误 | 配置正确项目 key |
| 新建 Jira 提示缺 `Zoom Module` / `Platform OS` / `Task Type` | `create_issue.additional_properties` 的字段 ID 或字段值与项目不匹配 | 查询项目字段元数据，把 `field_key` 改成正确的 `customfield_xxxxx` |
| 新建 Jira 期间反复弹权限确认 | agent 在查询 helper schema 或用错误字段名反复重试 | 使用配置好的 `customfield_xxxxx` 和 `--additional_properties`，只创建一次；失败后停止并报告要修正的字段 |
| MCP Jira 调用认证失败 | DevHelper MCP 认证过期或不可用 | 如果 host 支持，先认证 DevHelper MCP server 并重试一次；否则按 `transport_preference` fallback 到 `helper_cli` |
| Codex full access 可以访问 helper，但 default 权限返回 `NOT_AVAILABLE` 或 `exit -9` | Codex/Cursor sandbox/default 权限阻止或 kill 本地 helper 访问 Okta、Keychain、DevHelper app 或本地网络 | 保持 `transport_preference: [mcp, helper_cli]`，优先走 MCP；只有需要 CLI fallback 时再批准 host permission 或在外部终端认证 helper |
| 已有 Jira key，但 agent shell 里所有 transport 都不可用 | `require_jira` 只要求有格式正确的 key，字段 enrichment 才需要 transport | 提供已有 key；本地格式校验通过后可以启动 run，只是跳过 Jira 字段 enrichment |
| helper 命令退出码是 `0`，但预检仍显示 `NOT_AVAILABLE` | 旧预检逻辑 grep `accountId`，遇到不同输出格式会误判 | 使用 `SKILL.md` / `skills/intake/SKILL.md` 中新的按退出码判断的预检逻辑 |
| SPEC 字段回填提示 edit tool 不可用 | DevHelper Jira edit issue 能力未开启或不可用 | 开启 Jira edit issue 能力或 CLI helper connector 后重跑 `writeback_jira_spec.py`；脚本成功前 SPEC gate 会保持阻塞 |
| SPEC 写回失败并提示 `Vault corrupted` 或 keychain/vault 锁定 | helper CLI 无法读取 DevHelper 凭据 | 解锁/修复 helper vault，或使用具备写能力的 DevHelper MCP tools 完成写回后记录 `--record-external-success --transport mcp` |
| `customfield_12712` 拒绝设计正文 | ZOOM Technical Design spec 是 URL 字段，不应由 SPEC writeback 写正文 | 保持 `technical_design.update: false`，不要修改 Technical Design Spec |
| 流转失败并提示缺 Security Owner | ZOOM 工作流 validator 要求 `customfield_12892` | 重跑 `writeback_jira_spec.py`；脚本会保留/写入 Security Owner |
| 流转找不到 `Ready for Security Review` 且 issue 仍在 `Open` | S1/S2 的 `Open → In Progress` Jira 流转未执行 | 配置 `prerequisite_transition`，脚本会先补执行 `Open → In Progress` 后再重试安全评审流转 |
| 流转找不到 `Ready for Security Review` | transition 名称不等于目标状态名称 | 按目标状态 `Ready for Security Review` 选择，或配置 `transition_name: "technical design + threat model (if applicable) ready"` |
| Jira 调用认证失败 | Okta/Jira 会话过期 | 运行 `helper auth jira` |
| 评论或状态流转失败 | 权限或工作流不匹配 | 记录告警后继续流程 |
