# Customizing this template

What is written down here is what this template decided and what a Slack agent has to know. The Introspection skills own the rest: scaffolding, skills and subagents, evals and judges, bindings, tags, deployment, and everything else about the platform.

Every option below also appears as a comment in the file it belongs to, so `agents/agent.yaml` and `.introspection/slack-agent.yaml` are readable on their own.

## 1. Name the job

This is the only edit every adaptation needs.

`SYSTEM.md` currently describes a general assistant. Replace the **What this agent owns** section with the real job: who asks, what outcome the agent is accountable for, what it may rely on, and where it must stop.

Keep the other four sections roughly as they are unless the job contradicts them. They encode things that hold for any Slack agent:

- **How work reaches you** matches the platform's actual trigger rules, described below. Changing the prose does not change the rules.
- **Trust and scope** is the injection boundary. A Slack message can carry instructions from anyone in the channel, and so can anything the agent reads. Keep the requester as the only source of goals.
- **Every task** is the loop: read the thread, decide, acknowledge, work, report.
- **Final response** keeps the agent from finishing work the requester was never told about.

`SYSTEM.md` is the system prompt, so it holds prose only: no comments, scaffolding, examples, or placeholders. Every line is sent to the model on every turn. That is why this file exists separately.

## 2. The Slack surface

The package grant permits the whole Slack vocabulary. The agent selects three of them. Adding one is a single uncommented line in `agents/agent.yaml`.

| Tool | Slack call | Add it when |
| --- | --- | --- |
| `send_message` | `chat.postMessage` | Always. It is the only way to reach the person. |
| `react` | `reactions.add` | Always. Acknowledgement without a post. |
| `read_thread` | `conversations.replies` | Almost always. Requests refer to earlier messages. |
| `read_history` | `conversations.history` | The agent needs channel context beyond its own thread. |
| `list_channels` | `conversations.list` | The agent has to find a channel by name, or check its own membership. |
| `join_channel` | `conversations.join` | The agent should be able to join a public channel to read it. Weigh this one: it widens what the agent can see without a human inviting it. |
| `resolve_user` | `users.info` | Replies need real names or mentions rather than raw user ids. |
| `get_permalink` | `chat.getPermalink` | The agent links back to specific messages. |

Reads stay bounded by the Slack app's membership and its granted scopes, so a tool alone does not grant visibility.

`send_message` and `react` default to the channel and thread the task came from, so the ordinary reply needs no arguments beyond the text. `send_message` also takes `thread_ts`, `start_new_thread`, and provider-native `blocks` when the reply belongs somewhere else or should render as something richer than Markdown.

The runtime adds a short note to the system prompt telling the agent it is answering in a chat channel and that the person cannot see the transcript. Nothing else about the Slack tools is announced.

## 3. How work reaches the agent, and how it gets back

A mention or a direct message starts a task, a reply in a thread the agent already answered continues that task, and every other channel message is ignored. Bot messages, edits, and joins are dropped before they become tasks, so the agent cannot trigger itself. The README carries the full table.

After a `send_message` succeeds, the runtime records the posted message, which is what lets a later reply in that thread continue the same task rather than starting a new one.

Two consequences worth designing around:

- **Asking a question is cheap.** The agent can post a question and end the task; the person's reply continues it with the context intact. That is usually better than pausing the task on a platform interrupt, because a Slack-origin task has no interactive caller waiting on the API to resolve one.
- **A task that did not come from Slack has no origin channel.** `send_message` then has no default target, so an agent that also runs on a schedule or from your own service must be told where to post, or should post nowhere and return its result. If both paths matter, say so in `SYSTEM.md`.

## 4. Attach another connector

A connector is how the agent acts in a customer's account without ever holding the credential. The agent sees MCP tools; the egress proxy swaps a session locator for the real token on the way out, and enforces the connector's host and path allow-list.

| Provider | Agent tools | Can start a task | Notes |
| --- | --- | --- | --- |
| `slack` | Yes, runtime-hosted inside the task pod | Yes | The only inbound channel today |
| `linear` | Yes, Linear's own hosted MCP | No | Outbound only |
| `notion` | Yes, aggregator-hosted MCP | No | |
| `gmail` | Yes | No | Credential store |
| `google_calendar` | Yes | No | Credential store |
| `google_drive` | Yes | No | Credential store |
| `stripe` | Yes | No | Credential store |

A provider outside that catalog works too, with its own `authorization_endpoint` and `token_endpoint`, or an `issuer` the server resolves them from. All three placements, provider-hosted and aggregator-hosted and runtime-hosted, present the same recipe-facing contract.

### The two edits, plus a connection

A capability passes gates and the agent gets the intersection, so a new server is never one edit. The server id is the **app slug** in both files, never the connector's id or name, which is what keeps the recipe portable across projects whose connector rows differ.

```json
// package.json, pi.mcp.servers — the ceiling, alongside the existing slack entry
{
  "id": "notion",
  "required": false,
  "tools": { "include": ["<exact tool name>", "<exact tool name>"] }
}
```

```yaml
# agents/agent.yaml — what this role actually receives
mcp:
  mode: tools
  servers:
    slack:
      include:
        - send_message
        - react
        - read_thread
    notion:
      include:
        - <exact tool name>
```

Nothing in the recipe names the connector itself. What makes the server reachable happens on the platform: for Slack, the workspace connection you authorized against this runtime, which is also what routes the inbound event. For a provider whose MCP server is hosted elsewhere, an endpoint binding mounted for the runtime. The recipe declares which tools it may use; the project decides whether the server exists.

Every gate fails closed. A server with no `include`, a server missing from the agent's `servers`, and an omitted `mcp` block each mean no access. `include` takes exact tool names: `"*"` is a whole-toolset sentinel rather than a glob, so `search_*` is invalid, and `exclude` subtracts exact names afterwards and always wins.

Do not guess tool names, and do not expect to find them locally. Discovery has an ordering trap worth reading before you start:

- `include` needs exact tool names.
- The names come from `mcp list <server>`, which runs inside a session against a bound server.
- A bound connector server means a **deployed runtime and an authorized connection**. `introspection local` has no connectors, so this cannot happen on your machine.
- `mcp list` only exists when the agent is in `mcp.mode: cli`. In `mode: tools` there is no `mcp` command to run.

So the sequence is: deploy a runtime, create the connector, register the provider app against its delivery URL, authorize a connection, then temporarily set the agent to `mcp.mode: cli` with `include: ["*"]` for that server, run one task asking it to `mcp list <server>`, read the real tool refs out of the reply, narrow `include` to those names in both files, switch back to `mode: tools`, and redeploy.

The temporary `["*"]` is bounded by the connector's granted scopes, so it is a discovery step rather than a standing grant. Narrow it before the recipe goes anywhere near production.

Provider scopes never appear in the recipe. They are captured when the connection is authorized, so widening what the agent may do in Notion is a connector change rather than a recipe change.

Tool discovery happens once, when a task boots, so attaching or re-pointing a server takes effect on the next task rather than the running one. OAuth inside a task is always headless: cached credentials work, but no browser flow can launch, so a server needing interactive consent must be pre-authorized before a task uses it.

Unlike Slack, a newly attached server gets no injected note in the system prompt. Say in `SYSTEM.md` what it is for, and which source is authoritative when two of them cover the same ground.

Past about a dozen tools, switch the agent to `mcp.mode: cli`. It replaces every tool schema with one `mcp` command the agent searches, costing a single tool definition instead of forty. It needs `bash` in `tools`.

The `slack` entry ships as `"required": false` so a local run starts with no connector bound: the Slack tools are absent and the agent answers in the terminal, which is enough to prove instructions and model choice before a workspace exists. Set it to `true` once a workspace is bound and you would rather a session refuse to start than run without the ability to reply.

For a server you host yourself rather than a customer's account, the binding goes in a project endpoint, or in `.pi/mcp.local.json` for local work. That file is already gitignored, and it is a binding rather than an authorization: the server still has to clear the other two gates.

## 5. Work that takes more than one pass

A task ends when the model stops, which is wrong for work with real multi-step structure. The pattern that fixes it is a required end-of-cycle checkpoint tool: the agent reports `continue` with a concrete next step, or a terminal state, and an `agent_end` hook pushes a follow-up when the state was not terminal, up to a finite ceiling.

`slack-coding-agent/extensions/ralph-loop.mjs` is a complete implementation, in about a hundred lines. Copy it and rewrite the terminal-state contract in `SYSTEM.md` to match the job.

Leave it out for an agent that answers questions. A continuation loop on a one-shot task burns turns restating the same answer.

## 6. Give it a repository

This is the edit that turns a Slack agent into a coding agent.

```yaml
# .introspection/slack-agent.yaml
runtime:
  github:
    repositories:
      - your-org/your-repo
    permissions:
      contents: write
      pull_requests: write
```

Each slug must already be registered to the project. The grant authorizes a checkout rather than forcing one: a task names the subset it wants at `/workspace/repos/<name>`, or the agent clones it with ordinary `git` and `gh` against short-lived managed credentials. Reads are implicit and only write elevations are declared.

`SYSTEM.md` then needs the parts this template leaves out: which repository is relevant, that a pull request is the final write boundary, that shared history is never rewritten, and that checks are run and their failures reported. Add `edit` to `tools`.

The `slack-coding-agent` recipe is this template with all of that already written, including the continuation loop above. Prefer copying from it over rediscovering it.

## Reference

- [Connectors](https://docs.introspection.dev/platform/connectors) and the [connectors reference](https://docs.introspection.dev/platform/connectors-reference) — providers, auth modes, what a connection carries
- [MCP tool declarations](https://docs.introspection.dev/recipes/mcp) — the three gates and the in-session `mcp` CLI
- [Runtime manifest](https://docs.introspection.dev/platform/runtime-manifest) — every key in `.introspection/<slug>.yaml`
- [GitHub](https://docs.introspection.dev/platform/github) — the repository grant
