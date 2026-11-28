# Try Trade Shortcuts

[**Try the browser demo**](https://tradeshortcuts.xyz/sandbox/#liquidation) if you want to start immediately. Select **Liquidation alert → ▶ Play**, then use **Down → Click** to confirm **Close 50%**. The lens shows the paper fill. **Start over** resets the account.

## Hosted phone page

Open the [Trade Shortcuts phone app](https://tradeshortcuts.xyz/phone/). It connects to the public fake-only paper server without a token. No Bybit account, keys, or funds are needed.

## Local QR on your own G2

You need a phone paired with your G2, a computer with [Node.js 22.18+](https://nodejs.org/) and Git, and a trusted private Wi-Fi network shared by the phone and computer. Sign in to [Even Hub](https://hub.evenrealities.com/login) with the same account as on your phone, then fully quit and reopen the Even Realities app to enable its developer section. [Even Realities setup guide](https://hub.evenrealities.com/docs/get-started/quickstart)

**1. Run this in a terminal**

```sh
git clone https://github.com/AstralEX1/trade-shortcuts.git && cd trade-shortcuts && npm run demo -- --qr
```

Already cloned? Run `npm run demo -- --qr` in your checkout. The command installs dependencies on the first run and prints a QR code. The demo starts with a fresh paper account and needs no Bybit account, keys, or token entry.

**2. Scan and try a paper trade**

In the **Even Realities** app, open **Even Hub → Developer section → Scan QR** and scan the terminal QR. Keep the Even app and terminal open. When the **BTC long** liquidation alert appears, swipe down from **Dismiss** to **Close 50%**, then tap. The lens should show **Closed 0.025 BTC**, and the fill should appear in **History** on the phone.

The alert first appears about 30 seconds after the demo starts and can reopen while the condition holds. Press **Ctrl+C** to stop. Run `npm run demo -- --qr` again for a fresh account.

If the phone can't open the QR, check the two devices are on the same private Wi-Fi and allow the Even app local network access if prompted. With multiple network connections, run `npm run demo -- --qr YOUR_WIFI_IP` using the computer's Wi-Fi IPv4 address. This developer preview is open to devices that can reach the demo on your network while the command runs. [Even Hub local testing](https://hub.evenrealities.com/docs/test/local-testing)

## In the official Even Hub Simulator

On a computer with a desktop session, use the same clone command but omit `-- --qr`:

```sh
git clone https://github.com/AstralEX1/trade-shortcuts.git && cd trade-shortcuts && npm run demo
```

If you already cloned it, just run `npm run demo`. In the simulator use **Down → Click** on the BTC alert and check the fill in **Glasses Display** and in **History** in the simulator's **Browser** window. [Even Hub Simulator](https://hub.evenrealities.com/docs/test/simulator)

## Even Hub Beta

With an invitation, accept it on the Even account signed in on your phone, then install **Trade Shortcuts** from **Me → Beta tester** and open it from the G2 menu. The maintainer can confirm the build is in the **Beta** channel and your membership is **Active**. [Even Hub Beta testing](https://hub.evenrealities.com/docs/test/beta-testing)

In **Settings → Connection → Server**, leave the default public paper server **Address** and **Token** unchanged and blank, then tap **Connect**. Check for **Connected**, **Paper** or **Demo data** under **Account**, and **Live trading: Off** before testing. Turn **Answer alerts by voice** off for a gesture-only test. To use a private testnet server instead, enter its separate address and `APP_TOKEN`.

To verify the installed app can receive and answer a card, open **Settings → Even G2 → Send test to G2** and tap **OK** on **Connection check** on the lens. The phone should show **Confirmed on G2.** For a shortcut rehearsal, open the near-liquidation **Close position** shortcut, tap its title → **Test alert**, then select **Close 50%** on the G2. The result should say **Test only · nothing was sent** on the lens and in **History**.
