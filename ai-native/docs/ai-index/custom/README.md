# Custom Knowledge Base

This directory is for **human-authored knowledge** that the AI cannot automatically discover
from code, tests, or routing signals alone.

The knowledge bootstrap scans your repository to generate `flows/` and `modules/` docs.
This directory is intentionally **never touched by bootstrap** — everything here is yours to write
and maintain.

---

## When to Add a File Here

| Type | Add when... | Subdirectory |
|------|------------|--------------|
| Architecture decision | You made a design choice that isn't obvious from the code | `architecture/` |
| Gotcha / trap | Something that has bitten the team before | `gotchas/` |
| Team convention | A naming rule, pattern, or constraint not enforced by linter | `conventions/` |
| Deprecated approach | A path the team tried and abandoned, with reasons | `deprecated/` |

**Rule of thumb:** if a new engineer would make the same mistake without this file, it belongs here.

---

## How the AI Uses These Files

Files here are loaded during the **Clarify stage** when your request keywords match the
`scope` tags registered in `global-manifest.yaml → custom_refs`.

**To make a file discoverable, register it in `global-manifest.yaml`:**
```yaml
custom_refs:
  - path: docs/ai-index/custom/gotchas/webhook-retry.md
    scope: [webhook, retry, async, scheduler]
    summary: "Webhook 重试的已知陷阱：幂等性和超时配置"
  - path: docs/ai-index/custom/architecture/queue-design.md
    scope: [queue, mq, kafka, async]
    summary: "消息队列选型历史：为什么没有选 Kafka"
```

Files **not registered** in `custom_refs` are ignored by the AI process — they won't pollute
context for unrelated requests.

---

## File Format

Each file should follow this structure for maximum AI readability:

```markdown
# [Title — one line, descriptive]

## 适用范围
<!-- One sentence: when does this knowledge apply? -->

## 背景
<!-- What happened? Why does this exist? 2-5 sentences. -->

## 核心结论
<!-- The actionable takeaways. Keep to 1-5 bullets. -->
- 结论 1：...
- 结论 2：...

## 细节（可选）
<!-- Additional context, links, commit references, etc. -->

## 不适用场景（可选）
<!-- When should this knowledge NOT be applied? -->
```

---

## Subdirectory Guide

| Directory | Contents |
|-----------|---------|
| `architecture/` | Historical design decisions — why the system is structured the way it is |
| `gotchas/` | Traps, sharp edges, and non-obvious failure modes per module or flow |
| `conventions/` | Team agreements on naming, patterns, and constraints that live outside the linter |
| `deprecated/` | Approaches that were tried and abandoned, with explicit reasons |

---

## Maintenance

- **Add** a file whenever the team discovers a new gotcha or makes a significant design decision.
- **Update** files when the underlying code changes enough to make them stale.
- **Register** new files in `global-manifest.yaml → custom_refs` immediately after writing — an
  unregistered file does nothing.
- During the **Learn stage**, the AI may suggest adding a new custom entry based on what it
  discovered in the run. Review and accept/reject as you see fit.
