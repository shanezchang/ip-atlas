# Security

Report application vulnerabilities privately through [GitHub security advisories](https://github.com/shanezchang/plotip/security/advisories/new). Private vulnerability reporting is enabled for this repository. Include the affected commit, impact and a minimal reproduction using synthetic or documented public example addresses. Do not post credentials, personal query history or client IP logs in public issues.

The current `main` branch is maintained; older snapshots have no separate security-support window. Incorrect geolocation records are data-quality issues (see CONTRIBUTING), not proof of device location.

## Boundaries

- No accounts, paid providers, arbitrary URL fetching or writable application database. The bundled reverse index is immutable/read-only; XDB/SQLite files must never be served as frontend assets.
- IP lookup responses use `no-store`. History stays in the browser tab. No queried IPs or results are analytics events; hosting access logs are a separate platform concern.
- CI uses locked uv/npm installs, verified full Action commit SHAs and a read-only `contents` token. Checkout does not persist credentials; the `check` job has no deployment secrets or write permissions.
- Browser QA uses a production-mode local build. Its request allowlist blocks external services and telemetry writes while allowing the read-only lookup API. Error/empty fixtures are explicitly local test injections.

These controls and the automated checks are not a penetration-test certification. Review dependency advisories, source/data provenance and the deployment gate before publishing; do not bypass a failed `check` or automatically upgrade hosting.
