# Deploy to Vercel

The project uses the FastAPI framework preset. `pyproject.toml` points to `app:app`; `.python-version` selects Python 3.12 and `uv.lock` pins dependencies. The build runs `npm ci && npm run build` and writes the frontend into root `public/`. `app.frontend()` explicitly declares that generated directory so Vercel promotes its files to the CDN, even when no local build output was uploaded.

The XDB files, `ranges.sqlite` and `places.json` are outside `public/` and are included only in the Python Function. Do not move them into frontend assets. `vercel.json` excludes caches, source frontend files, tests and Node modules from the function. No environment secrets are required.

For your own deployment, import your fork into Vercel, choose FastAPI, leave the root directory at repository root, and use the committed configuration. Confirm that your deployment's root HTML, map worker and `/api/lookup` work. Confirm `/data/ip2region_v4.xdb` and `/data/ranges.sqlite` return 404, and verify `/api/ranges?area=country:US&version=4`.

Static map assets consume normal CDN traffic; lookup results are small JSON responses. Functions consume invocation/CPU/memory allowances. Personal non-commercial use can fit Hobby's included resources, but free hosting is not unlimited. Do not turn on paid upgrades automatically.

Use Vercel's platform protection and usage monitoring if traffic grows. Application memory is per-instance and cannot provide global rate limits. This app does not proxy arbitrary URLs, perform DNS resolution, or call paid providers.

## Maintainer workflow

Normal releases use GitHub → CI → Vercel. Keep the existing workflow **Checks**, job/check-run **`check`**: cloud gates refer to that exact name. As configured and read back by the maintainer on 2026-10-11:

- GitHub `main` requires `check`, an up-to-date branch (`strict`) and administrator enforcement. Changes go through a PR; the required approving-review count is 0, so independent review remains a maintainer responsibility rather than an enforced approval count.
- Vercel requires the GitHub external check `check` for the same source SHA before `deployment-alias` on the `production` target, with a 3600-second timeout. Automatic aliasing remains enabled but waits for the check.

A 2026-10-11 negative control (unchanged application blobs, deliberately failed `check`) blocked GitHub merging and left the ready production candidate unaliased; all existing production aliases stayed on the previous deployment. However, Vercel's native check remained `running`, not a resolved failure. This proves the observed hold, not complete result propagation. The first normal GitHub `main` release must verify the success path for the exact SHA, including check resolution and alias assignment. Retain the old deployment until that verification passes; do not force-promote to bypass a failed or unresolved check.

Verify the linked project with `vercel project inspect --non-interactive`; never reuse another project's `.vercel/` directory. A separately authorized manual release can use `vercel deploy --prod --skip-domain`, validate the immutable deployment with `vercel curl --deployment <url>`, and only then promote. This is an exception, not an alternative to required checks.

For rollback, retain the previous production deployment ID and restore its alias using the platform's supported rollback path, then read back the alias and repeat IP lookup and range-pagination smoke tests. No data migration is involved in the label/focus refinement. A first deployment can receive its alias automatically; verify it immediately.

## This deployment

- Website: https://plotip.vercel.app/
- GitHub: https://github.com/shanezchang/plotip
- Vercel project: `plotip`, scope `shanes-projects-025e82ba`.
