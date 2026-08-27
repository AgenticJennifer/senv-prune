import assert from "node:assert/strict";
import test from "node:test";

import {
  checkCredential,
  classifyHttpStatus,
  classifyProviderResponse,
  credentialReport,
  parseArgs,
  parseDotenv,
  pruneDuplicateAssignments,
} from "../senv-prune.mjs";

test("parses quoted dotenv values without evaluating them", () => {
  const parsed = parseDotenv('OPENAI_API_KEY="secret"\nDANGEROUS=$(touch /tmp/nope)\n');
  assert.equal(parsed.values.get("OPENAI_API_KEY"), "secret");
  assert.equal(parsed.values.get("DANGEROUS"), "$(touch /tmp/nope)");
});

test("keeps the last duplicate assignment and preserves comments", () => {
  const input = "# before\nAPI_KEY=old\n\nAPI_KEY=new\n# after\n";
  const result = pruneDuplicateAssignments(input);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.content, "# before\n\nAPI_KEY=new\n# after\n");
});

test("parses safe operational flags", () => {
  const options = parseArgs(["--recursive", "--dry-run", "--check-keys", "--no-prune", "/tmp"]);
  assert.equal(options.recursive, true);
  assert.equal(options.dryRun, true);
  assert.equal(options.checkKeys, true);
  assert.equal(options.prune, false);
  assert.deepEqual(options.paths, ["/tmp"]);
});

test("classifies provider responses", () => {
  assert.equal(classifyHttpStatus(200).status, "valid");
  assert.equal(classifyHttpStatus(401).status, "invalid");
  assert.equal(classifyHttpStatus(403).status, "unauthorized");
  assert.equal(classifyHttpStatus(429).status, "rate_limited");
});

test("never returns credential values", async () => {
  const secret = "sk-test-secret-value";
  const result = await checkCredential("OPENAI_API_KEY", secret, new Map(), {
    fetchImpl: async () => ({ status: 200 }),
  });
  assert.equal(result.status, "valid");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.match(result.fingerprint, /^sha256:[a-f0-9]{12}$/);
});

test("does not call providers for placeholders", async () => {
  let called = false;
  const result = await checkCredential("OPENAI_API_KEY", "your-key-here", new Map(), {
    fetchImpl: async () => {
      called = true;
      return { status: 200 };
    },
  });
  assert.equal(result.status, "missing");
  assert.equal(called, false);
});

test("checks labeled OpenRouter keys", async () => {
  const result = await checkCredential("OPENROUTER_KEY_JENNIFER", "sk-or-test", new Map(), {
    fetchImpl: async () => ({ status: 200 }),
  });
  assert.equal(result.provider, "OpenRouter");
  assert.equal(result.status, "valid");
});

test("preserves each key label when a paired check is cached", () => {
  const cached = {
    key: "LANGFUSE_SECRET_KEY",
    provider: "Langfuse",
    status: "valid",
    fingerprint: "sha256:old",
  };
  const report = credentialReport("app.env", "LANGFUSE_PUBLIC_KEY", "pk-live", cached);
  assert.equal(report.key, "LANGFUSE_PUBLIC_KEY");
  assert.notEqual(report.fingerprint, cached.fingerprint);
});

test("reports a scope-limited ElevenLabs key as unauthorized", async () => {
  const response = new Response(JSON.stringify({
    detail: { status: "missing_permissions" },
  }), { status: 401, headers: { "Content-Type": "application/json" } });
  const result = await classifyProviderResponse("ElevenLabs", response);
  assert.equal(result.status, "unauthorized");
  assert.match(result.detail, /models_read/);
});

test("reports a suspended Google consumer as invalid", async () => {
  const response = new Response(JSON.stringify({
    error: { details: [{ reason: "CONSUMER_SUSPENDED" }] },
  }), { status: 403, headers: { "Content-Type": "application/json" } });
  const result = await classifyProviderResponse("YouTube Data API", response);
  assert.equal(result.status, "invalid");
  assert.match(result.detail, /suspended/);
});
