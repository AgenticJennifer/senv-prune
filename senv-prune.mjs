#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const VERSION = "0.4.0";
const SKIP_DIRECTORIES = new Set([
  ".cache",
  ".env-backups",
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".reports",
  ".tox",
  ".venv",
  "build",
  "dist",
  "node_modules",
  "venv",
]);
const PLACEHOLDER_PATTERN = /^(x+|your[-_]|replace[-_]|change[-_]?me|example|placeholder|<.+>)/i;
const SECRET_NAME_PATTERN = /(API_?KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|PUBLIC_KEY)$/i;

const PROVIDERS = {
  AIRTABLE_API_KEY: {
    name: "Airtable",
    request: (value) => ({
      url: "https://api.airtable.com/v0/meta/whoami",
      headers: { Authorization: `Bearer ${value}` },
    }),
  },
  ELEVENLABS_API_KEY: {
    name: "ElevenLabs",
    request: (value) => ({
      url: "https://api.elevenlabs.io/v1/models",
      headers: { "xi-api-key": value },
    }),
  },
  EXA_API_KEY: {
    name: "Exa",
    request: (value) => ({
      url: "https://api.exa.ai/websets/v0/teams/me",
      headers: { "x-api-key": value },
    }),
  },
  FIRECRAWL_API_KEY: {
    name: "Firecrawl",
    request: (value) => ({
      url: "https://api.firecrawl.dev/v2/team/credit-usage",
      headers: { Authorization: `Bearer ${value}` },
    }),
  },
  GEMINI_API_KEY: {
    name: "Google Gemini",
    request: (value) => ({
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      headers: { "x-goog-api-key": value },
    }),
  },
  GITHUB_TOKEN: {
    name: "GitHub",
    request: (value) => ({
      url: "https://api.github.com/user",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${value}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }),
  },
  NVIDIA_API_KEY: {
    name: "NVIDIA",
    request: (value) => ({
      url: "https://integrate.api.nvidia.com/v1/models",
      headers: { Authorization: `Bearer ${value}` },
    }),
  },
  OPENAI_API_KEY: {
    name: "OpenAI",
    request: (value) => ({
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: `Bearer ${value}` },
    }),
  },
  RESEND_API_KEY: {
    name: "Resend",
    request: (value) => ({
      url: "https://api.resend.com/api-keys",
      headers: { Authorization: `Bearer ${value}` },
    }),
  },
  YOUTUBE_API_KEY: {
    name: "YouTube Data API",
    request: (value) => ({
      url: "https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ",
      headers: { "x-goog-api-key": value },
    }),
  },
};

function usage() {
  return `senv-prune v${VERSION}

Deduplicate dotenv files safely and optionally verify API credentials.

Usage:
  senv-prune [options] <file ...>
  senv-prune --recursive [options] <directory ...>

Options:
  --check-keys       Run read-only provider authentication checks
  --dry-run          Report changes without writing files or backups
  --git              Refuse automatic secret commits; retained for compatibility
  --json             Emit a machine-readable report to stdout
  --no-prune         Inventory/check keys without deduplicating files
  -r, --recursive    Discover live dotenv files recursively
  --timeout <ms>     Per-request timeout (default: 10000)
  -h, --help         Show this help
`;
}

export function parseArgs(argv) {
  const options = {
    checkKeys: false,
    dryRun: false,
    gitCommit: false,
    json: false,
    prune: true,
    recursive: false,
    timeout: 10_000,
    paths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--check-keys":
        options.checkKeys = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--git":
        options.gitCommit = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--no-prune":
        options.prune = false;
        break;
      case "-r":
      case "--recursive":
        options.recursive = true;
        break;
      case "--timeout": {
        const value = Number(argv[index + 1]);
        if (!Number.isInteger(value) || value < 100 || value > 120_000) {
          throw new Error("--timeout must be an integer between 100 and 120000");
        }
        options.timeout = value;
        index += 1;
        break;
      }
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
        options.paths.push(argument);
    }
  }

  return options;
}

export function parseDotenv(content) {
  const entries = [];
  const values = new Map();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = normalizeValue(match[2]);
    entries.push({ index, key, value });
    values.set(key, value);
  }

  return { entries, lines, values };
}

function normalizeValue(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function pruneDuplicateAssignments(content) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const { entries, lines } = parseDotenv(content);
  const lastIndex = new Map();
  for (const entry of entries) lastIndex.set(entry.key, entry.index);

  const duplicateIndexes = new Set(
    entries.filter((entry) => lastIndex.get(entry.key) !== entry.index).map((entry) => entry.index),
  );
  const output = lines.filter((_, index) => !duplicateIndexes.has(index)).join(newline);
  return { content: output, duplicatesRemoved: duplicateIndexes.size };
}

function isLiveDotenv(filename) {
  const lower = filename.toLowerCase();
  if (/(example|sample|template|backup|\.bak$|\.old$)/.test(lower)) return false;
  return (
    lower === ".env" ||
    lower === ".env.local" ||
    lower === ".env.development" ||
    lower === ".env.production" ||
    lower === ".env.test" ||
    lower.endsWith(".env")
  );
}

async function discoverFiles(inputPaths, recursive) {
  const requested = inputPaths.length > 0 ? inputPaths : [process.cwd()];
  const files = [];

  for (const requestedPath of requested) {
    const absolute = path.resolve(requestedPath);
    let metadata;
    try {
      metadata = await stat(absolute);
    } catch {
      throw new Error(`Path does not exist: ${absolute}`);
    }

    if (metadata.isFile()) {
      files.push(absolute);
      continue;
    }
    if (!metadata.isDirectory()) continue;
    if (!recursive) throw new Error(`Directory requires --recursive: ${absolute}`);

    const queue = [absolute];
    while (queue.length > 0) {
      const directory = queue.pop();
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) queue.push(candidate);
        } else if (entry.isFile() && isLiveDotenv(entry.name)) {
          files.push(candidate);
        }
      }
    }
  }

  return [...new Set(files)].sort();
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function isMissing(value) {
  return PLACEHOLDER_PATTERN.test(value) || /^\$\{[^}]+\}$/.test(value);
}

function providerForKey(key) {
  if (PROVIDERS[key]) return PROVIDERS[key];
  if (/^OPENROUTER_(?:API_)?KEY(?:_|$)/.test(key)) return { name: "OpenRouter", custom: "openrouter" };
  if (key === "MAKE_API_KEY") return { name: "Make", custom: "make" };
  if (key === "WANDB_API_KEY") return { name: "Weights & Biases", custom: "wandb" };
  if (key === "LANGFUSE_PUBLIC_KEY" || key === "LANGFUSE_SECRET_KEY") {
    return { name: "Langfuse", custom: "langfuse" };
  }
  return null;
}

export function classifyHttpStatus(status) {
  if (status >= 200 && status < 300) return { status: "valid", detail: "Authentication accepted" };
  if (status === 400 || status === 401) {
    return { status: "invalid", detail: "Credential rejected or expired" };
  }
  if (status === 402) return { status: "valid_no_credits", detail: "Accepted, but credits are unavailable" };
  if (status === 403) return { status: "unauthorized", detail: "Accepted format, but access is forbidden or restricted" };
  if (status === 429) return { status: "rate_limited", detail: "Provider rate limit reached" };
  if (status >= 500) return { status: "service_error", detail: "Provider service error" };
  return { status: "unverified", detail: `Unexpected provider response (${status})` };
}

export async function classifyProviderResponse(providerName, response) {
  if (providerName === "ElevenLabs" && response.status === 401) {
    const body = await response.clone().json().catch(() => null);
    if (body?.detail?.status === "missing_permissions") {
      return {
        status: "unauthorized",
        detail: "Credential is active but lacks the models_read permission",
      };
    }
  }

  if ((providerName === "Google Gemini" || providerName === "YouTube Data API") && response.status >= 400) {
    const body = await response.clone().json().catch(() => null);
    const reason = body?.error?.details?.find((detail) => detail?.reason)?.reason;
    if (reason === "ACCOUNT_STATE_INVALID") {
      return { status: "invalid", detail: "Bound Google service account is deleted or disabled" };
    }
    if (reason === "CONSUMER_SUSPENDED") {
      return { status: "invalid", detail: "Google API consumer is suspended" };
    }
  }

  return classifyHttpStatus(response.status);
}

async function requestWithTimeout(fetchImpl, request, timeout) {
  return fetchImpl(request.url, {
    body: request.body,
    headers: {
      Accept: "application/json",
      "User-Agent": `senv-prune/${VERSION}`,
      ...request.headers,
    },
    method: request.method || "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
}

function trustedLangfuseBase(rawBase) {
  const base = rawBase || "https://cloud.langfuse.com";
  try {
    const url = new URL(base);
    const trustedCloud = url.protocol === "https:" && (
      url.hostname === "langfuse.com" || url.hostname.endsWith(".langfuse.com")
    );
    const trustedLocal = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    return trustedCloud || trustedLocal ? url.origin : null;
  } catch {
    return null;
  }
}

async function checkCustomProvider(custom, value, context, fetchImpl, timeout) {
  if (custom === "openrouter") {
    const response = await requestWithTimeout(fetchImpl, {
      url: "https://openrouter.ai/api/v1/key",
      headers: { Authorization: `Bearer ${value}` },
    }, timeout);
    return { ...classifyHttpStatus(response.status), httpStatus: response.status };
  }

  if (custom === "make") {
    const configured = context.get("MAKE_BASE_URL");
    const bases = configured ? [configured] : [
      "https://us1.make.com",
      "https://us2.make.com",
      "https://eu1.make.com",
      "https://eu2.make.com",
    ];
    let lastResponse;
    for (const rawBase of bases) {
      let base;
      try {
        const url = new URL(rawBase);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".make.com")) continue;
        base = url.origin;
      } catch {
        continue;
      }
      lastResponse = await requestWithTimeout(fetchImpl, {
        url: `${base}/api/v2/users/me`,
        headers: { Authorization: `Token ${value}` },
      }, timeout);
      if (lastResponse.status !== 401 && lastResponse.status !== 404) break;
    }
    if (!lastResponse) return { status: "unverified", detail: "No trusted Make zone configured" };
    return { ...classifyHttpStatus(lastResponse.status), httpStatus: lastResponse.status };
  }

  if (custom === "wandb") {
    const response = await requestWithTimeout(fetchImpl, {
      url: "https://api.wandb.ai/graphql",
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${value}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "query SenvPruneViewer { viewer { entity } }" }),
    }, timeout);
    if (!response.ok) return { ...classifyHttpStatus(response.status), httpStatus: response.status };
    const body = await response.json().catch(() => null);
    if (body?.data?.viewer) {
      return { status: "valid", detail: "Authentication accepted", httpStatus: response.status };
    }
    return { status: "invalid", detail: "Credential rejected or expired", httpStatus: response.status };
  }

  if (custom === "langfuse") {
    const publicKey = context.get("LANGFUSE_PUBLIC_KEY");
    const secretKey = context.get("LANGFUSE_SECRET_KEY");
    if (!publicKey || !secretKey || isMissing(publicKey) || isMissing(secretKey)) {
      return { status: "missing", detail: "Both Langfuse public and secret keys are required" };
    }
    const base = trustedLangfuseBase(context.get("LANGFUSE_BASE_URL"));
    if (!base) return { status: "unverified", detail: "Langfuse base URL is not trusted" };
    const response = await requestWithTimeout(fetchImpl, {
      url: `${base}/api/public/projects`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
      },
    }, timeout);
    return { ...classifyHttpStatus(response.status), httpStatus: response.status };
  }

  return { status: "unverified", detail: "No read-only validator is available" };
}

export async function checkCredential(key, value, context, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeout = options.timeout || 10_000;
  const provider = providerForKey(key);

  if (!value || isMissing(value)) {
    return {
      key,
      provider: provider?.name || "Unmapped",
      status: "missing",
      detail: "Value is empty, referenced, or a placeholder",
    };
  }
  if (!provider) {
    return {
      key,
      provider: "Unmapped",
      status: "unverified",
      detail: "No safe read-only validator is available",
      fingerprint: fingerprint(value),
    };
  }

  try {
    let result;
    if (provider.custom) {
      result = await checkCustomProvider(provider.custom, value, context, fetchImpl, timeout);
    } else {
      const response = await requestWithTimeout(fetchImpl, provider.request(value, context), timeout);
      result = { ...await classifyProviderResponse(provider.name, response), httpStatus: response.status };
    }
    return { key, provider: provider.name, fingerprint: fingerprint(value), ...result };
  } catch (error) {
    return {
      key,
      provider: provider.name,
      fingerprint: fingerprint(value),
      status: "network_error",
      detail: error?.name === "TimeoutError" ? "Provider request timed out" : "Provider request failed",
    };
  }
}

export function credentialReport(file, key, value, check) {
  return {
    file,
    ...check,
    key,
    ...(value && !isMissing(value) ? { fingerprint: fingerprint(value) } : {}),
  };
}

async function backUpAndWrite(file, content) {
  const metadata = await stat(file);
  const backupDirectory = path.join(path.dirname(file), ".env-backups");
  await mkdir(backupDirectory, { mode: 0o700, recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(backupDirectory, `${path.basename(file)}.${stamp}.bak`);
  await copyFile(file, backup);
  await chmod(backup, metadata.mode & 0o777);

  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(temporary, content, { mode: metadata.mode & 0o777 });
  await rename(temporary, file);
  return backup;
}

function summarize(credentials, files) {
  const statuses = {};
  for (const credential of credentials) {
    statuses[credential.status] = (statuses[credential.status] || 0) + 1;
  }
  return {
    credentials: credentials.length,
    duplicatesRemoved: files.reduce((sum, file) => sum + file.duplicatesRemoved, 0),
    files: files.length,
    filesChanged: files.filter((file) => file.changed).length,
    statuses,
  };
}

async function run(options) {
  const files = await discoverFiles(options.paths, options.recursive);
  const fileReports = [];
  const credentialReports = [];
  const credentialCache = new Map();

  for (const file of files) {
    const original = await readFile(file, "utf8");
    const parsed = parseDotenv(original);
    const pruned = pruneDuplicateAssignments(original);
    const changed = options.prune && pruned.content !== original;
    let backup = null;

    if (changed && !options.dryRun) backup = await backUpAndWrite(file, pruned.content);
    fileReports.push({
      backup,
      changed,
      duplicatesRemoved: options.prune ? pruned.duplicatesRemoved : 0,
      file,
    });

    const secretEntries = [...parsed.values.entries()].filter(
      ([key]) => SECRET_NAME_PATTERN.test(key) || providerForKey(key),
    );
    for (const [key, value] of secretEntries) {
      let check;
      if (options.checkKeys) {
        const provider = providerForKey(key);
        const pair = provider?.custom === "langfuse"
          ? `${parsed.values.get("LANGFUSE_PUBLIC_KEY")}:${parsed.values.get("LANGFUSE_SECRET_KEY")}:${parsed.values.get("LANGFUSE_BASE_URL")}`
          : value;
        const cacheKey = `${provider?.name || key}:${fingerprint(pair || "missing")}`;
        if (!credentialCache.has(cacheKey)) {
          credentialCache.set(cacheKey, await checkCredential(key, value, parsed.values, {
            timeout: options.timeout,
          }));
        }
        check = credentialCache.get(cacheKey);
      } else {
        check = {
          key,
          provider: providerForKey(key)?.name || "Unmapped",
          status: value && !isMissing(value) ? "present" : "missing",
          detail: "Not checked",
          ...(value && !isMissing(value) ? { fingerprint: fingerprint(value) } : {}),
        };
      }
      credentialReports.push(credentialReport(file, key, value, check));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? "dry-run" : "write",
    version: VERSION,
    summary: summarize(credentialReports, fileReports),
    files: fileReports,
    credentials: credentialReports,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const file of fileReports) {
      const action = file.changed ? (options.dryRun ? "WOULD_PRUNE" : "PRUNED") : "UNCHANGED";
      process.stdout.write(`[${action}] ${file.file} duplicates=${file.duplicatesRemoved}\n`);
    }
    for (const credential of credentialReports) {
      process.stdout.write(`[${credential.status.toUpperCase()}] ${credential.provider} ${credential.key} (${credential.file})\n`);
    }
    process.stdout.write(`[DONE] senv-prune v${VERSION}\n`);
  }

  return report;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    const report = await run(options);
    if (options.gitCommit && !options.dryRun && report.summary.filesChanged > 0) {
      throw new Error("--git is intentionally disabled for dotenv files; review and commit explicitly");
    }
  } catch (error) {
    process.stderr.write(`senv-prune: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
