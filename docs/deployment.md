# Deploy Trade Shortcuts

Release in this order: **VPS API instances → hosted web build → Even Hub package**. Build all three from the same verified commit. The 0.1.0 beta predates size and leverage selection. Use the next available version in `app/app.json` and check it in the portal before uploading.

## Prepare the release

Export the release commit into a clean directory with `git archive`. From that directory, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:site`. Keep local environment files and databases outside the export. Record the commit and the resulting package SHA-256 for the release.

## VPS

Run one systemd service per account with distinct loopback ports, persistent SQLite directories and `APP_TOKEN` values. Use the VPS's existing unit names, proxy origins and ports. Check the unit's `FragmentPath` and `DropInPaths` with `systemctl show` to find its configuration.

| Service | Configuration |
|---|---|
| Hosted demo | `EXCHANGE=fake`, `PUBLIC_DEMO=1`, dedicated public-demo `APP_TOKEN`. Voice and Telegram are disabled in this mode. |
| Bybit test account | `EXCHANGE=bybit` with the demo or testnet origin and its own keys, plus a private `APP_TOKEN`. Set optional voice or Telegram credentials for this service only. |

Set each unit's `WorkingDirectory` to its release directory and keep `server/data/` persistent across releases. Use a separate protected `EnvironmentFile` per service and keep `HOST=127.0.0.1`. Configure nginx to terminate TLS at each origin and forward `/api/` to the matching loopback port. Pass through the `Authorization` header and keep the `/api/` prefix.

Take a SQLite backup before starting the new service. Opening the DB versions legacy actions, withdraws pending proposals of those versions and pauses rules that need price-window review. Validate nginx with `nginx -t` before reloading it. After restarting both services, verify the authenticated `GET /api/state` returns the expected source for each origin and voice is off on the hosted demo. Verify the demo and testnet tokens differ locally without displaying either value. Exercise a pick and confirmation on the demo account. For rollback, stop the affected service and preserve the current DB before restoring the previous release and backup. Reconcile any orders submitted after the backup with the exchange before re-enabling trading.

## Web and Even Hub

1. Deploy the landing and sandbox output from `site/landing/`. The sandbox has its own in-memory exchange and does not need a token.
2. If releasing the separate hosted phone demo, build the app with `VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN` set to the hosted paper origin. `VITE_DEMO_TOKEN`, if set, becomes public JavaScript. Use only the dedicated fake-exchange token there. Test hosted Settings and a paper alert after deploying.
3. From the same clean export, run `npm run pack -- "$DEMO_HTTPS_ORIGIN" "$TESTNET_HTTPS_ORIGIN" "trade-shortcuts-$BUILD_VERSION.ehpk"`. The first origin is the default. The packer clears `VITE_DEMO_TOKEN` for this build. Check version, allowed origins and the digest before handing it to the portal owner.
4. In Beta, verify install, connection, Review, size and leverage selection, and a paper fill on G2. Until clients update, older beta clients still receive state but omit the new lens heartbeat. Telegram can deliver a fallback while an older G2 client is open.
