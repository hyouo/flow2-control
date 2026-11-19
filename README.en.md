# FLOW2 Control

I rewrote the driver for my Lofree FLOW 2 simply because the official one sucks.

FLOW2 Control supports the standard ANSI FLOW 2 84 (OE927) and has English and Chinese interfaces. Plug the keyboard in over USB to remap keys, record macros and adjust the white backlight in your browser. When you select **Save to keyboard**, the configurator reads the settings back over VIA 12 to verify each change. The keyboard stores one configuration. Your browser keeps your other profiles and drafts. [Open the configurator](https://hyouo.github.io/flow2-control/) · [中文](README.md)

## Configure a key

1. Set the keyboard to wired mode and connect a USB data cable. Open the HTTPS site in desktop Chrome or Edge. On Windows you can also use the included desktop launcher.
2. Select **Configure via USB** and choose **Flow2@Lofree**. Open **Key assignments** at the top of the workspace, choose Windows or macOS, then Base or Fn. A dashed mark on an Fn keycap means it inherits the action displayed from that system’s base layer. The keyboard’s physical OS shortcuts are Fn+N for Windows and Fn+M for Mac.
3. To map **Ins** to **Home** on the Windows base layer, click **Ins** on the keyboard diagram and choose **Home** under **Keys**. The bottom bar shows **Ins → Home**. Click **Save to keyboard**, wait for readback, then select **Test this key** and press the physical **Ins** key to verify its output.

![Remap a key. The arrows point to Ins at the top right of the keyboard, Home in the action list and Save to keyboard in the bottom bar.](docs/images/remap-en.png)

The keyboard stores six layers and one onboard configuration. Sixteen macro slots share 2,976 bytes. The backlight supports five levels, steady and breathing. Select the right edge of the case to see the stock volume, display brightness and enable gestures. The Device page contains USB, Bluetooth and 2.4G instructions. [Official manual](https://cdn.shopify.com/s/files/1/2779/9046/files/Flow2_84_UserManual.pdf?v=1792140117)

Use the arrow keys to move across the keyboard and Enter to select a key. After searching for an action, press Down to focus the results, Enter to assign, and Escape to return to the physical key. A keycap marked M1–M16 opens the corresponding macro assignment. The editor shows the full macro name.

## Record and assign a macro

Open **Macros** and select an empty slot, such as M1. Click **Record and append**, press **Ctrl+C** in the recording area, then click **Stop recording**. The timeline shows when each key was pressed and released. Click **Assign to key →**, pick a key on the keyboard diagram to trigger the macro, then click **Save to keyboard**. If you only changed the macro name, click **Save in this browser**.

![Record a copy shortcut. The arrows mark slot M1 on the left, Record and append at the bottom right and Assign to key above the timeline.](docs/images/macro-en.png)

## Profiles and compatibility

To undo the last write, open **Profiles** and click **Load snapshot** in the **Restore pre-write snapshot** row. For the remap above, the preview should show **Home → Insert**. Check the direction, click **Load draft**, then **Save to keyboard** to finish restoring the key. A resumed write keeps the original snapshot, even after reopening the page.

![Restore the Insert mapping. The upper arrow points to Load snapshot. The lower arrows identify the Home → Insert change and the Load draft button.](docs/images/restore-en.png)

The browser keeps local profiles, macro names and drafts. Export a JSON file to transfer a configuration between computers or origins. A device backup uses confirmed assignments and their saved macro names. A draft export includes pending edits. Version 1 and 2 backups retain all 540 matrix positions, including unknown 16-bit codes. Profiles can be inspected and exported with USB disconnected. The included navigation profile uses synthetic assignments.

Configuration requires desktop WebHID over USB. Input testing also works over Bluetooth and 2.4G. Browsers without WebHID offer the profile viewer, manual and event tester. The static site can reopen offline in the same browser after its first complete load. See the [hardware record](HARDWARE-TEST.md) for measured results.

## Development

With Node.js 20 or later, run `npm start` and open `http://127.0.0.1:8842/`. The local server exits after its last window closes. Run `npm run build` to create `dist/` for static HTTPS hosting. GitHub Pages project paths are supported. The **Publish to GitHub Pages** workflow runs on manual dispatch.

Run `npm test` for protocol and editor tests. Run `npm ci` and `npm run test:browser` for the offline and browser suite using installed Chrome. Set `FLOW2_BROWSER=msedge` to test installed Edge. For a physical test, run `npm run test:hardware -- chrome` or `npm run test:hardware -- msedge`. Select your wired keyboard and press the physical Ins key when prompted. The test restores the captured baseline and verifies the complete configuration. CI is configured for Windows and macOS. [MIT license](LICENSE) · [Inter font license](public/fonts/OFL.txt)
