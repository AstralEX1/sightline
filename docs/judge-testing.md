# Test Trade Shortcuts on your Even G2

Use the Even Realities app on the phone already paired with your G2. The walkthrough uses paper positions and requires no Bybit account, API keys, or funds. A ring is optional.

## Even Hub Beta

1. Accept the Trade Shortcuts invitation for the Even account signed in on your phone. The project maintainer needs to see **Active** membership and a build in the **Beta** channel for `com.tradeshortcuts.g2`. In the Even Realities app, go to **Me → Beta tester**, install **Trade Shortcuts 0.1.4**, then open it from the G2 menu. If the phone says the test version expired, ask the maintainer to check both conditions. [Even Hub Beta testing](https://hub.evenrealities.com/docs/test/beta-testing), [Membership status](https://hub.evenrealities.com/docs/cli/testers)
2. In the plugin’s phone view, open **Settings → Connection → Server**. Use the dedicated paper **Address** and **Token** received separately through a private channel, then tap **Connect**. Check for **Connected**, an **Account** line starting with **Paper** or **Demo data**, and **Live trading: Off**. Turn **Answer alerts by voice** off for this walkthrough. If the account says **Bybit demo** or **Bybit testnet**, stop before confirming anything.
3. Check that paper positions appear on the glasses. If your paper server supports the connection check, go to **Settings → Even G2** and tap **Send test to G2**. On the glasses, tap **OK** on the **TEST** card titled **Connection check**. The phone should say **Confirmed on G2.** If a paper proposal is ahead of the connection card, select **Dismiss** on that proposal.
4. Back in **Shortcuts**, open the **Close position** shortcut with a near-liquidation condition and a **50%** close. Tap the shortcut title at the top of the editor and select **Test alert**. On the G2, wait for the card marked **TEST**, swipe to highlight **Close 50%**, then tap once. Check for **Test only · nothing was sent** on the lens and in phone **History**. This rehearses the confirmation and leaves paper positions unchanged. If there’s no matching paper position, use the browser fallback below.

## Local QR on your own G2

Use this route without a Trade Shortcuts invitation. Sign in to the Even Hub developer website with your own Even account, restart the Even Realities app, and open **Scan QR** in the developer section of **Even Hub**. Put the phone and computer on the same trusted private Wi-Fi. Keep the phone app open during the test. [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode), [Local testing](https://hub.evenrealities.com/docs/test/local-testing), [Community QR and packaging notes](https://github.com/nickustinov/even-g2-notes/blob/main/docs/packaging.md)

1. In a clean checkout without `.env` files, use Node.js 22.18+ and run `npm ci`. Generate a disposable local value of at least 16 characters privately, for example with a password manager. Use it only for this local paper account. In a Bash or zsh terminal, paste it at the hidden prompt and leave the server running.

   ```sh
   (
     printf 'Local paper token: '
     IFS= read -rs APP_TOKEN
     printf '\n'
     APP_TOKEN="$APP_TOKEN" EXCHANGE=fake PAPER_DEMO=1 PUBLIC_DEMO=1 HOST=127.0.0.1 PORT=8787 node server/src/main.ts
   )
   ```

2. In a second terminal, run `PORT=8787 VITE_APP_TOKEN= VITE_DEMO_TOKEN= VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN= npm run dev -- --host --strictPort`. In a third, run `npx evenhub qr --url 'http://YOUR-LAN-IP:5173'`, replacing `YOUR-LAN-IP` with the computer’s Wi-Fi address. Scan in the Even Realities app. In **Connection → Server**, leave **Address** blank, enter your disposable local **Token**, and tap **Connect**. The QR contains only the dev page URL and the token stays out of the dev bundle. Use this disposable token only on the trusted network because local QR uses HTTP. [Even Hub QR command](https://hub.evenrealities.com/docs/cli/project#evenhub-qr)
3. For a paper fill, wait for the automatic BTC alert with the **Close 50%** choice. It first appears about 30 seconds after server start and can repeat while the condition holds. On that card, swipe to **Close 50%** and tap once. Look for **Closed 0.025 BTC** on the G2 and the fill in **History**. Stop and restart the local paper server for a fresh 0.05 BTC position and a clean replay.

## Browser fallback

Open the browser sandbox, choose **Liquidation alert**, and press **▶ Play**. Use **Down** to highlight **Close 50%**, then **Click**. The simulated lens shows the paper fill. **Start over** starts a fresh account. This route needs no access credentials or glasses. [Trade Shortcuts sandbox](https://trade-shortcuts-pi.vercel.app/sandbox/)

For a device result, record what you saw on the physical G2 and whether the phone acknowledged the connection test. The browser result verifies the software flow on a simulated display.
