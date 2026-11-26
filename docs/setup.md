# Setup

For a fresh paper session with the Even Hub Simulator, follow [Run the demo](../README.md#run-the-demo). The steps below cover a persistent local account, device preview, and packaging.

## Run the services separately

1. Install [Node.js 22.18 or newer](https://nodejs.org/) and run `npm ci`.
2. For a new local configuration, copy [`.env.example`](../.env.example) to `.env` and set `APP_TOKEN` to a random value at least 16 characters long. Leave `EXCHANGE=fake` for built-in paper positions.
3. Run `npm run server`, `npm run dev`, and `npm run sim` in three terminals. The app runs on [localhost:5173](http://localhost:5173/) and proxies API requests to the server at port 8787.
4. In the phone page, open **Settings → Connection** and enter the server access token. Keep exchange and provider credentials in the server's `.env`.

The standalone server stores the account and History in `server/data/`. Set `PAPER_DEMO=1` with `EXCHANGE=fake` for an in-memory session.

| Integration | Configuration |
| --- | --- |
| Bybit Demo or Testnet | Set `EXCHANGE=bybit` and provide the API key and secret for the chosen environment. Set `BYBIT_BASE` to `https://api-demo.bybit.com` or `https://api-testnet.bybit.com`, respectively. |
| Voice answers | Set `OPENAI_API_KEY` on the server and enable voice answers in Settings. When a trade alert opens the G2 microphone, the server passes captured audio to OpenAI for transcription. |

For a hosted paper-only backend, set `PUBLIC_DEMO=1` with `EXCHANGE=fake`. This mode disables transcription. The browser sandbox uses its own in-memory backend.

## Preview on Even G2

1. Pair the glasses with the Even Realities app. Sign in with your Even Hub developer account and enable Developer Mode. [Even Hub local testing guide](https://hub.evenrealities.com/docs/test/local-testing)
2. Put the phone and computer on the same Wi-Fi. Keep `VITE_APP_TOKEN` and `VITE_DEMO_TOKEN` empty for device preview and shared builds.
3. Run the configured backend and start Vite with `npm run dev -- --host`.
4. Run `npm run qr` on macOS, or run `npx evenhub qr --url http://YOUR-LAN-IP:5173` with your computer's LAN address. Scan from the Even Realities app and enter the token under **Settings → Connection**. [Even Hub CLI QR command](https://hub.evenrealities.com/docs/cli/project#evenhub-qr)

## Build an Even Hub package

Run the command below with the HTTPS origin where the configured backend is reachable.

```sh
npm run pack -- https://your-backend.example
```

This creates `trade-shortcuts.ehpk` and allowlists the given origin in the manifest. To allowlist additional backends, append their HTTPS origins. The first is the default. The packer clears the hosted-page demo credential for device builds. For a device test, upload the package and assign it to a Beta group in Even Hub. Once installed, enter the server access token under **Settings → Connection**. [Even Hub beta testing](https://hub.evenrealities.com/docs/test/beta-testing)

## Build the website

From the repository root, run `npm ci` and `npm run build:site`. Serve `site/landing/` to open the landing page and the generated `/sandbox/` route. With Python installed, run `python3 -m http.server 8080 --bind 127.0.0.1 --directory site/landing` and open [localhost:8080](http://localhost:8080/). The sandbox also runs on [localhost:5199](http://localhost:5199/) with `npm run sandbox`. It creates a fresh paper account for each tab.
