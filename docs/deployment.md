# Deploy Trade Shortcuts

Use one verified commit for the release. When the server changes, release the VPS API before the hosted site and Even Hub package. Use the next available version in `app/app.json` and check the portal before uploading.

## Prepare the release

Export the release commit into a clean directory with `git archive`. From that directory, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:site`. Keep local environment files and databases outside the export. Record the commit and the resulting package SHA-256 for the release.

## VPS

Run one systemd service per account with distinct loopback ports, persistent SQLite directories and `APP_TOKEN` values. Use the VPS's existing unit names, proxy origins and ports. Check the unit's `FragmentPath` and `DropInPaths` with `systemctl show` to find its configuration.

| Service | Configuration |
|---|---|
| Hosted demo | `EXCHANGE=fake`, `PUBLIC_DEMO=1`, dedicated public-demo `APP_TOKEN`. Voice is disabled in this mode. |
| Bybit test account | `EXCHANGE=bybit` with the demo or testnet origin and its own keys, plus a private `APP_TOKEN`. Set optional voice credentials for this service only. |

Set each unit's `WorkingDirectory` to its release directory and keep `server/data/` persistent across releases. Use a separate protected `EnvironmentFile` per service and keep `HOST=127.0.0.1`. Configure nginx to terminate TLS at each origin and forward `/api/` to the matching loopback port. Pass through the `Authorization` header and keep the `/api/` prefix.

Take a SQLite backup before starting the new service. Opening the DB versions legacy actions, withdraws pending proposals of those versions and pauses rules that need price-window review. Validate nginx with `nginx -t` before reloading it. After restarting both services, verify the authenticated `GET /api/state` returns the expected source for each origin and voice is off on the hosted demo. Verify the demo and testnet tokens differ locally without displaying either value. Exercise a pick and confirmation on the demo account. For rollback, stop the affected service and preserve the current DB before restoring the previous release and backup. Reconcile any orders submitted after the backup with the exchange before re-enabling trading.

## Web and Even Hub

1. From the clean export, build the hosted phone app for `/phone/` alongside the landing and sandbox.
   ```sh
   env -u VITE_DEMO_TOKEN -u VITE_APP_TOKEN VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN="$DEMO_HTTPS_ORIGIN" \
     npm run build -- --base=/phone/ --outDir="$PWD/site/landing/phone"
   ```
2. Deploy `site/landing/` to the Vercel site project. Verify `/phone/` can connect to the hosted paper API with a user-supplied app token and `/sandbox/` can run a paper scenario on its own.
3. From the same clean export, run `npm run pack -- "$DEMO_HTTPS_ORIGIN" "$TESTNET_HTTPS_ORIGIN" "trade-shortcuts-$BUILD_VERSION.ehpk"`. The first origin is the default. The packer clears `VITE_DEMO_TOKEN` for this build. Check version, allowed origins and the digest before handing it to the portal owner.
4. Promote the uploaded version to Beta and verify that testers are Active. Follow the [store and device checklist](store-listing.md) before submitting for public review.
