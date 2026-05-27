# JIRA Integration Guide

> Maintenance note: this document must be maintained in both English and Chinese. Any update should be reflected in the paired Chinese version in the same change.

## Overview

AI-Native JIRA integration wires four stages (INTAKE, SPEC, IMPLEMENT, LEARN) to a JIRA project through DevHelper transports. The repo-init default tries **DevHelper MCP first** and uses the local **DevHelper `helper` CLI** only as fallback. SPEC writeback is blocking when a run is linked to Jira; other write-back operations are advisory and log warnings without stopping the stage.

## Prerequisites

1. DevHelper MCP should be enabled in the host when available. Agents must inspect each MCP tool schema before calling it.
2. **DevHelper `helper` CLI** should be installed at `${HOME}/.local/bin/helper` for fallback and for operations not exposed by MCP.
3. Your Jira connector auth must be active. If CLI JIRA calls fail with authentication errors, run:
   ```
   ${HOME}/.local/bin/helper auth jira
   ```

4. Verify the DevHelper Jira CLI connector is available when using the fallback transport:
   ```bash
   ${HOME}/.local/bin/helper connector jira JIRA_GET_CURRENT_USER
   ```
   Exit code `0` means available. Do not rely on grepping for a specific field such as `accountId`;
   DevHelper output may vary by version.

## Default Behavior

The repo-init template enables JIRA integration by default so every new governed run asks whether
to link an existing issue, create a new issue, or explicitly skip JIRA before `start_run.py`.
The default block in `ai-native/.ai-process.binding.yaml` is:

```yaml
jira_integration:
  enabled: true
  project_key: "ZOOM"          # Change if the repo belongs to another JIRA project
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
  require_jira: true            # Blocks governed runs without a JIRA issue
  writeback:
    intake: true
    spec: true
    implement: true
    learn: true
  release_policy_path: "ai-native/rules/release-policy.yaml"
```

If the repository uses a different JIRA project, update `project_key` immediately after onboarding.
The ZOOM starter values use custom field IDs verified for creating `Task` issues:
`customfield_13244` for Zoom Module, `customfield_14917` for Platform OS, and `customfield_12821`
for Task Type.

`transport_preference` is ordered. `mcp` means DevHelper MCP Jira tools such as `jira_create_issue`,
`jira_get_issue`, `jira_add_comment`, `jira_get_transitions`, and `jira_transition_issue`. `helper_cli`
means `${HOME}/.local/bin/helper connector jira ...`. Do not use browser automation as a Jira fallback.
When MCP lacks a write operation such as field edit in a given host, the agent tries `helper_cli`; if no
write-capable transport is available, the stage records a warning and does not perform the Jira transition.

When the user chooses to create a new issue, the agent resolves the default fields as follows:
- `Zoom Module`: uses the configured value, defaulting to `Build System`.
- `Platform OS`: AI-inferred from the request and repo scope; defaults to `All` when the work is not OS-specific.
- `Task Type`: AI-inferred from the request intent; defaults to `Technical Enhancement`.

For engineering-driven tasks, the agent renders a one-line summary from `summary_format` and writes
the five standard question responses into the JIRA description before the original request. The
description must use plain labels and hyphen bullets, not Markdown headings, Markdown tables,
blockquotes, or ordered-list section markers. This avoids Jira/ADF rendering artifacts such as
repeated `1.` / `a.` prefixes.

To validate your config:
```bash
SKILL_ROOT=$(python3 -c "import os,sys; [print(c) or sys.exit(0) for c in [os.path.expanduser('~/.codex/skills/ai-process-core'),os.path.expanduser('~/.cursor/skills/ai-process-core')] if os.path.isdir(c)]")
python3 "$SKILL_ROOT/scripts/ai_process/validate_jira_config.py"
```

## Run Naming

When JIRA integration is enabled and the user provides or creates an issue before the run starts,
the orchestrator passes the key to `start_run.py`:

```bash
python3 "$SKILL_ROOT/scripts/ai_process/start_run.py" \
  --request "<raw request>" \
  --jira-issue-key "ZOOM-134325" \
  --actor-type agent
```

The runtime directory then uses the JIRA key, for example:
`ai-native/runtime/ai-process/runs/RUN-ZOOM-134325-20260519093000/`.

If `require_jira: false` and the user chooses `skip`, or JIRA is disabled/unavailable, the run falls
back to the request slug or request hash. With the repo-init default `require_jira: true`, the run
must not start until an existing or newly created JIRA key is available.

## What Happens at Each Stage

### S1 — INTAKE

Before the run is created, the orchestrator asks whether the request has an existing JIRA issue,
should create a new issue, or should skip JIRA. This decision happens before code search and before
any process artifact is written so the run id can use the linked JIRA key.

When `require_jira: true`, an existing user-provided key is enough to start the run after local key
format validation, even if no Jira transport is available in the agent sandbox. A Jira transport is
required only when the agent must create a new issue or enrich the intent from JIRA fields.

| Action | DevHelper operation |
|--------|---------------|
| Fetch existing JIRA issue into `intent.md` | MCP `jira_get_issue` or CLI `JIRA_GET_ISSUE` |
| Create new JIRA issue from captured intent | MCP `jira_create_issue` or CLI `JIRA_CREATE_ISSUE` |
| Post intent summary as comment | MCP `jira_add_comment` or CLI `JIRA_ADD_COMMENT` |
| Transition issue Open → In Progress | MCP `jira_get_transitions` + `jira_transition_issue`, or CLI `JIRA_TRANSITION_ISSUE` |

The linked issue key is stored in `run-state.json → jira_issue_key` and carried through all later stages.

### S3 — SPEC

| Action | DevHelper operation |
|--------|---------------|
| Deterministic SPEC writeback | `python3 ai-native/scripts/ai_process/writeback_jira_spec.py --run-id <RUN_ID>` |
| Backfill Description field when original is sparse | CLI `JIRA_EDIT_ISSUE` via the writeback script; rendered as Jira-safe plain text, not Markdown headings or ordered-list section markers |
| Technical Design Spec URL field (`customfield_12712`) | Not modified by AI-Native SPEC writeback |
| Backfill Risk Analysis fields (`customfield_15634`, `customfield_15635`, `customfield_15636`, `customfield_15637`, `customfield_15638`, `customfield_15639`, `customfield_15886`, `customfield_17370`, `customfield_25604`) | CLI `JIRA_EDIT_ISSUE` via the writeback script |
| Preserve/write Security Owner (`customfield_12892`) | CLI `JIRA_EDIT_ISSUE`; required by the ZOOM security-review workflow validator |
| Transition to Ready for Security Review after field edit succeeds | CLI `JIRA_GET_TRANSITIONS` + `JIRA_TRANSITION_ISSUE`; if the issue is still `Open`, the script first runs the configured prerequisite `Open` → `In Progress` transition, then retries the security-review transition |

For linked Jira issues with `jira_integration.writeback.spec: true`, SPEC is blocked until the
writeback script records `jira_spec_writeback_succeeded` in the run history. This prevents local runs
from completing while Jira fields are still empty.

If helper CLI is unavailable because the local DevHelper vault/keychain is locked, a host may use
write-capable DevHelper MCP tools instead. The host must perform the same field update without modifying
Technical Design Spec, add the audit comment, and transition, verify Jira shows the target fields/status,
then call `writeback_jira_spec.py --record-external-success --transport mcp` to record the gate evidence.
Do not record external success before the Jira writeback actually succeeds; the SPEC gate requires the
success event to include the configured target status.

### S4 — IMPLEMENT

| Action | DevHelper operation |
|--------|---------------|
| Post time estimate (from task annotations or heuristic) | MCP `jira_add_comment` or CLI `JIRA_ADD_COMMENT` |

The JIRA status is **not changed** at this stage — that is the developer's responsibility.

To add explicit effort annotations to tasks, use `[~Xh]` at the end of a task line:
```markdown
- [ ] 1.1 Add config block [~2h]
- [ ] 1.2 Update docs [~30m]
```

### S7 — LEARN

| Action | DevHelper operation |
|--------|---------------|
| Read fix versions for CC check | `jira_get_issue` |
| Post MR Checklist + reviewer suggestions | `jira_add_comment` |
| Link MR to JIRA issue | `jira_add_remote_link` |

The LEARN stage also parses `release-policy.yaml` to detect the current release checkpoint. If a Code Freeze is active or the fix version triggers a CC requirement, the stage **blocks** until you either provide a CC ticket key or explicitly override.

## CC (Change Control) Workflow

When CC is required, the LEARN stage prompts:

```
❌ CHANGE CONTROL (CC) REQUIRED before pushing

Paste the CC ticket key to continue (e.g., CC-456)
— OR —
Type: OVERRIDE: no CC needed <your reason>
```

- Providing a CC key stores it in `run-state.json → cc_ticket_key` and records a `cc_confirmed` event.
- Using `OVERRIDE` stores the reason and records a `cc_override` event (audited in `events.jsonl`).

## Finding Your JIRA Field IDs

Issue creation can require project-specific fields such as `Zoom Module`, `Platform OS`, and `Task Type`.
The repo-init template uses verified ZOOM `customfield_xxxxx` keys in
`create_issue.additional_properties.*.field_key`, and the create command passes them through
`--additional_properties`. If another JIRA project rejects those IDs, query field metadata for the
project/issue type and update the binding once. Do not repeatedly call create issue to probe field
names.

SPEC writeback also uses configured custom fields. The repo-init defaults identify `customfield_12712`
as the Technical Design Spec URL field but leave it untouched, use `customfield_12892` for Security
Owner, and use the verified ZOOM Risk Analysis fields under `spec_writeback.risk_analysis.fields`.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| MCP Jira call returns auth error | DevHelper MCP auth expired or unavailable | Authenticate the DevHelper MCP server once if the host supports it, then retry; otherwise fall back to `helper_cli` if configured |
| `jira_get_issue` or `JIRA_GET_ISSUE` returns auth error | Okta/Jira session expired | Run `okta-auth-cli` skill or `${HOME}/.local/bin/helper auth jira` for CLI fallback |
| Helper works in Codex full access but returns `NOT_AVAILABLE` or exits `-9` in default mode | Codex/Cursor sandbox/default permission blocks or kills local helper access to Okta, Keychain, DevHelper.app, or local network | Keep `transport_preference: [mcp, helper_cli]` so MCP is tried first; approve host permission or authenticate helper externally only if CLI fallback is needed |
| Existing JIRA key is available but all transports fail in the agent shell | `require_jira` only needs a syntactically valid key, while enrichment requires a transport | Provide the existing key; the run may start without JIRA enrichment after local key format validation |
| Helper command exits `0` but the precheck says `NOT_AVAILABLE` | Old precheck logic grepped for `accountId` and misread a valid response with a different output shape | Use the updated exit-code based precheck from `SKILL.md` / `skills/intake/SKILL.md` |
| Repeated permission popups during new Jira creation | The agent is probing helper schema or retrying failed field names | Use the configured `customfield_xxxxx` IDs and `--additional_properties`; make one create attempt, then stop and report any validation error |
| SPEC field backfill fails with edit tool unavailable | DevHelper Jira edit issue capability is disabled or unavailable | Enable the Jira edit issue tool/capability or CLI helper connector, then rerun `writeback_jira_spec.py`; the SPEC gate remains blocked until it succeeds |
| SPEC writeback fails with `Vault corrupted` or keychain/vault lock errors | The helper CLI cannot read DevHelper credentials | Unlock/fix helper vault, or use write-capable DevHelper MCP tools and then record `--record-external-success --transport mcp` |
| `customfield_12712` rejects generated design text | ZOOM Technical Design spec is a URL field and should not receive SPEC writeback text | Keep `technical_design.update: false`; do not modify Technical Design Spec |
| `jira_transition_issue` fails with missing Security Owner | ZOOM workflow validator requires `customfield_12892` | Rerun `writeback_jira_spec.py`; it preserves/writes Security Owner before transition |
| `jira_transition_issue` cannot find `Ready for Security Review` while issue is still `Open` | The S1/S2 `Open → In Progress` Jira move did not run | Configure `prerequisite_transition`; the script runs `Open → In Progress` and retries the security-review transition |
| `jira_transition_issue` fails because transition is not found | Transition display name is not the target status name | Select by target status `Ready for Security Review`, or configure `transition_name: "technical design + threat model (if applicable) ready"` |
| JIRA comment not posted | `jira_add_comment` returned error | Check DevHelper logs; run proceeds without blocking |
| CC gate stuck | User didn't provide CC key or OVERRIDE | Type `CC-<number>` or `OVERRIDE: no CC needed <reason>` |
