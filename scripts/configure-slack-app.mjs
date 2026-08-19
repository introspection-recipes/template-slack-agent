#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const recipeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(recipeRoot, "slack-app", "manifest.template.json");
const credentialsPath = resolve(recipeRoot, ".slack", "credentials.json");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function render(template) {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => required(name));
}

async function slack(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${required("SLACK_APP_CONFIG_TOKEN")}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const details = Array.isArray(payload.errors)
      ? `: ${payload.errors.map((item) => item.message).join("; ")}`
      : "";
    throw new Error(`${method} failed (${payload.error ?? response.status})${details}`);
  }
  return payload;
}

const template = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(render(template));
await slack("apps.manifest.validate", { manifest });

const existingAppId = process.env.SLACK_APP_ID?.trim();
const response = existingAppId
  ? await slack("apps.manifest.update", { app_id: existingAppId, manifest })
  : await slack("apps.manifest.create", { manifest });

const output = {
  app_id: response.app_id ?? existingAppId,
  oauth_authorize_url: response.oauth_authorize_url ?? null,
  credentials: response.credentials ?? null,
  permissions_updated: response.permissions_updated ?? false,
  generated_at: new Date().toISOString(),
};

await mkdir(dirname(credentialsPath), { recursive: true, mode: 0o700 });
await writeFile(credentialsPath, `${JSON.stringify(output, null, 2)}\n`, {
  mode: 0o600,
});

console.log(`Slack app ${existingAppId ? "updated" : "created"}: ${output.app_id}`);
console.log(`Sensitive response stored with mode 0600 at ${credentialsPath}`);
if (output.oauth_authorize_url) console.log(`Authorize: ${output.oauth_authorize_url}`);
if (output.permissions_updated) console.log("Slack requires the app to be reinstalled for the permission changes.");
