# senv-prune

![Version](https://img.shields.io/badge/version-0.4-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**Safely deduplicate dotenv files and verify API credential status without exposing secret values.**

## Safety guarantees

- `--dry-run` never writes files or creates backups.
- Credential values are never printed. Reports contain only variable names and short SHA-256 fingerprints.
- Dotenv files are parsed as text and are never sourced or executed.
- Live checks use read-only provider endpoints and a request timeout.
- Generated backups and status reports are ignored by Git.
- `--git` will not automatically commit dotenv files; secret commits must be reviewed explicitly.

## Quick Start

Preview duplicate removal for specific files:

```bash
./senv-prune.sh --dry-run --json .env backend/.env
```

Inventory and verify keys recursively without modifying dotenv files:

```bash
./senv-prune.sh --recursive --dry-run --no-prune --check-keys --json ~/Projects
```

Remove duplicates after reviewing the dry-run:

```bash
./senv-prune.sh --recursive ~/Projects
```

## Credential checks

Read-only checks are implemented for Airtable, ElevenLabs, Exa, Firecrawl, GitHub, Google Gemini, Langfuse, Make, NVIDIA, OpenAI, OpenRouter, Resend, Weights & Biases, and the YouTube Data API.

Unknown, local-only, or provider-specific credentials are reported as `unverified`. A credential receiving `403` is reported as `unauthorized` rather than `invalid`, because the key may be valid but lack the endpoint's required scope.

## Statuses

| Status | Meaning |
|---|---|
| `valid` | Authentication was accepted. |
| `invalid` | The provider rejected the credential or it expired. |
| `unauthorized` | The request was authenticated but forbidden or scope-restricted. |
| `valid_no_credits` | Authentication succeeded but no credits are available. |
| `rate_limited` | The provider rate-limited the check. |
| `missing` | The value is empty, referenced, or a placeholder. |
| `unverified` | No safe read-only validator exists or the response was inconclusive. |
| `network_error` | The provider could not be reached before timeout. |

## Development

```bash
npm test
npm run check
```
