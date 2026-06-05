# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of `openclaw-groupme`.

## Reporting a Vulnerability

Please report suspected vulnerabilities through GitHub private vulnerability reporting:

https://github.com/oddrationale/openclaw-groupme/security/advisories/new

If private reporting is unavailable, open a GitHub issue with a high-level description only and avoid posting exploit details, secrets, tokens, callback URLs, or personal data. I will follow up privately when needed.

## Scope

Reports are especially helpful when they involve:

- GroupMe webhook authentication or replay handling
- SSRF, media download, or image upload handling
- Access control, mention detection, or command bypass behavior
- Secret handling and redaction
- OpenClaw plugin registration or configuration parsing

## Response

I will acknowledge valid reports as soon as practical, investigate impact, and publish a patched release when a fix is available.
