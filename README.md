# Slack Agent Template

A Slack agent recipe. Someone mentions the bot or sends it a direct message, a task starts, and the agent replies in that thread.

Start here when you want a Slack bot and the job it does is still yours to define. The recipe runs as it stands and is built to be specialized: `CUSTOMIZE.md` lists what the platform can add to it, and every option appears as a comment in the file it belongs to.

If you already know the job is a coding agent that opens pull requests, `slack-coding-agent` is this shape with a GitHub grant and a bounded continuation loop already written.

## What is in the package

| File | What it decides |
| --- | --- |
| `SYSTEM.md` | The job, the trust boundary, and how the agent behaves in a thread. Shared by every agent in the recipe. |
| `agents/agent.yaml` | Model, built-in tools, and which Slack tools this role receives. |
| `package.json` | The ceiling: the MCP servers and tools the recipe may ever use, under `pi.mcp`. |
| `.introspection/<slug>.yaml` | Runtime slug, model mode, and the connector-backed apps the runtime needs. The filename stem is the slug. |
| `slack-app/manifest.template.json` | The Slack app definition: scopes and the events that reach the agent. |
| `CUSTOMIZE.md` | The menu of platform capabilities available to this recipe, with the exact edit each one takes. |

`agents/agent.yaml` and the runtime manifest carry their options as comments beside the live values. Read them before adding anything; most of what a Slack agent needs is already written down there, switched off.

`SYSTEM.md` has no comments on purpose. It is the system prompt, so every line in it is sent to the model.

## How Slack reaches the agent

The connector's webhook route verifies Slack's signature, resolves the connection, and dispatches to the runtime bound to it:

| Slack event | What happens |
| --- | --- |
| A mention of the bot, in a channel it is in | Starts a task |
| A direct message to the bot | Starts a task |
| A reply in a thread the agent already answered | Continues that task |
| Any other channel message | Ignored. A channel the bot merely sits in stays silent. |

Bot messages, edits, and joins are dropped before they become tasks, so the agent cannot trigger itself.

The reply travels the other way through the same connection. `send_message` defaults to the channel and thread the task came from, so the ordinary case needs no arguments beyond the text. The runtime also adds a short note to the system prompt telling the agent it is answering in a chat channel and that the person cannot see the transcript.

## Run it locally first

Local runs need no Slack workspace and no Introspection login. The `slack` server is declared `"required": false`, so a local session starts without it, the Slack tools are simply absent, and the agent answers in the terminal. That is enough to prove the instructions and the model choice before any of the setup below.

```bash
introspection local -p "Summarize what you are able to do and what you would need to do more."
```

Run it from the directory holding `package.json`.

If that exits immediately with `Request was aborted` and no output, Pi has no credential for the provider this recipe declares. `ai.model` in `agents/agent.yaml` is authoritative and a command-line override will not win, so either authenticate that provider or change the model to one you are logged into. The underlying error is only visible in Pi's own logs, so the bare abort is worth recognizing on sight.

## Connect a Slack workspace

Deploy the recipe first so the runtime exists, then create the connector, register the Slack app against it, and authorize a workspace.

Two placeholders appear below. `<your-runtime-slug>` is the filename stem of your manifest in `.introspection/`; scaffolding renames that file and the package for you but not the prose in this README, so check it matches before running the authorize command. `<control-plane-host>` is the API host your CLI is logged into, which `introspection whoami` prints as the base URL; Slack has to reach it over the public internet to verify the events URL.

1. At [api.slack.com/apps](https://api.slack.com/apps), create a **Blank app** in the target workspace. On **Basic Information**, copy its Client ID, Client Secret, and Signing Secret.

2. Put the Client Secret on line 1 and the Signing Secret on line 2 of a temporary `secret-file`, then create the connector. Replace `<client-id>` with the non-secret Client ID that Slack shows.

```bash
chmod 600 secret-file
exec 3<secret-file
IFS= read -r SLACK_CLIENT_SECRET <&3
IFS= read -r SLACK_SIGNING_SECRET <&3
exec 3<&-

introspection connectors create \
  --name "<Your Agent> (staging)" \
  --slug slack \
  --provider slack \
  --auth-mode oauth-stored \
  --environment staging \
  --client-id '<client-id>' \
  --client-secret "$SLACK_CLIENT_SECRET" \
  --signing-secret "$SLACK_SIGNING_SECRET" \
  --authorization-endpoint https://slack.com/oauth/v2/authorize \
  --token-endpoint https://slack.com/api/oauth.v2.access \
  --api-host slack.com \
  --scope chat:write --scope app_mentions:read \
  --scope channels:history --scope channels:read --scope channels:join \
  --scope groups:history --scope groups:read \
  --scope im:history --scope im:read \
  --scope mpim:history --scope mpim:read \
  --scope reactions:write --scope users:read \
  --yes --non-interactive

unset SLACK_CLIENT_SECRET SLACK_SIGNING_SECRET
```

The connector `--slug` is the MCP server id the recipe uses. Keep it `slack` unless you change `pi.mcp.servers` in `package.json` and the agent's `mcp.servers` together.

3. Copy the connector `id` from the output. On the Slack app's **App Manifest** page, paste [`slack-app/manifest.template.json`](slack-app/manifest.template.json) with its two placeholders replaced:

```text
SLACK_OAUTH_REDIRECT_URL=https://<control-plane-host>/v1/oauth/connections/callback
SLACK_EVENTS_REQUEST_URL=https://<control-plane-host>/v1/webhooks/slack/<connector-id>
```

Save it and confirm that Slack marks the Events API request URL **Verified**. Then activate the same URL on the connector:

```bash
introspection connectors update slack \
  --webhook-url 'https://<control-plane-host>/v1/webhooks/slack/<connector-id>' \
  --status active \
  --yes --non-interactive
```

Nothing derives that URL for you. The platform stores it rather than computing it, so ingress can move hosts without invalidating every registration.

4. Bind a workspace to the deployed runtime. Open the single-use URL this prints and click **Allow** in Slack:

```bash
introspection connectors authorize slack \
  --runtime <your-runtime-slug> \
  --subject app
```

The URL is a single-use bearer capability. Mint one per customer and never cache or reuse it.

5. In Slack, run `/invite @Agent` in a channel, then mention the bot with a real request.

Delete `secret-file` once authorization succeeds. The encrypted connector copy is the source of truth.

`scripts/configure-slack-app.mjs` does step 3 through Slack's Manifest API instead of the web form, if you would rather script it. It needs `SLACK_APP_CONFIG_TOKEN` and writes the response to `.slack/credentials.json` with mode 0600.

## Validate

```bash
introspection check
```

This validates the package, the agent files, and the MCP policy. It cannot prove Slack ingress or the connector credential path, which is what staging is for.

## Adapt it

`CUSTOMIZE.md` covers what is specific to this template and to Slack agents generally: what to change in `SYSTEM.md` first, the eight Slack tools and when each earns its place, how a reply continues a task, attaching another connector and the declarations it needs, multi-pass work, and the repository grant that turns this into a coding agent.

It stops there on purpose. Skills, subagents, evals, judges, bindings, tags, and deployment are platform concerns the Introspection skills already own.

Every option in it also appears as a comment in the file it belongs to.
