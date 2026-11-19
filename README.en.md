# FLOW2 Control

I rewrote the driver for my Lofree FLOW 2 simply because the official one sucks.

FLOW2 Control is an open-source web configurator for the **Lofree FLOW 2 84, standard ANSI edition (OE927)**. Plug it in over USB to remap keys, record macros and adjust the white backlight in desktop Chrome or Edge. The configurator reads back each change when you save. Your keymaps and macros stay on the keyboard and work over Bluetooth and 2.4 GHz.

**[Open the configurator](https://hyouo.github.io/flow2-control/)** · [Download the static site ZIP](https://github.com/hyouo/flow2-control/releases/latest/download/flow2-control-web.zip) · [Release notes](https://github.com/hyouo/flow2-control/releases) · [中文](README.md)

## Configure a key

This example maps **Ins** to **Home** on the Windows base layer.

1. Switch the keyboard to wired mode, connect a USB data cable and use **Fn+N** to select Windows mode on the keyboard. Open the configurator, click **Configure via USB** and choose **Flow2@Lofree** in the browser prompt.
2. Open **Key assignments** and select **Windows → Base**. Click **Ins** at the top right of the keyboard diagram, then **Home** in the action list. The bottom bar shows the pending **Ins → Home** change.
3. Click **Save to keyboard**. Once readback is confirmed, click **Test this key** and press the physical **Ins** key. The tester should receive **Home**.

![Three arrows point to the physical Ins key on the diagram, Home in the action list and Save to keyboard in the bottom bar.](docs/images/remap-en.png)

On your first visit, you can also open **Profiles → View navigation sample** to explore a profile without connecting a keyboard.

## Features and guides

- **Keymaps and macros.** Edit the base and Fn layers for Windows and macOS. Assign keys, shortcuts, media controls or macros to the 84 physical keys. Sixteen macro slots share 2,976 bytes. Record keystrokes or edit text, presses, releases and delays on the timeline.
- **Profiles and backups.** The keyboard stores one onboard configuration. Your browser keeps named profiles, macro names and unsaved drafts. Export a JSON file to move a profile to another computer. A device backup contains confirmed settings. A draft export includes pending edits.
- **Backlight and touch strip.** Choose from five white backlight levels with steady or breathing effects. Select the right edge of the keyboard diagram for the stock gestures, including swiping to change volume and holding Fn while swiping to adjust display brightness.
- **Key tester.** See the press and release events your browser receives and how many keys are held at once over USB, Bluetooth or 2.4 GHz.

<details>
<summary>Record Ctrl+C and assign it to a key</summary>

Open **Macros** and select an empty slot, such as M1. Click **Record and append**, press **Ctrl+C** in the recording area, then click **Stop recording**. The timeline shows the press and release of each key. Click **Assign to key →**, pick a key on the diagram, then click **Save to keyboard**. If you only changed the macro name, click **Save in this browser**.

![Slot M1, Record and append, and Assign to key in the macro editor.](docs/images/macro-en.png)

</details>

<details>
<summary>Restore the configuration from before your last write</summary>

The configurator keeps a snapshot in your browser before each write. Open **Profiles** and click **Load snapshot** in the **Restore pre-write snapshot** row. To undo the remap above, look for **Home → Insert** in the preview. Click **Load draft**, then **Save to keyboard** to apply it. Resuming an interrupted write keeps the original restore point.

![Load snapshot opens a preview showing Home → Insert. Load draft brings the change into the editor.](docs/images/restore-en.png)

</details>

## Compatibility

The configurator talks to the stock firmware over WebHID using VIA 12. Tests on a standard OE927 confirmed that settings survive a power cycle and onboard macros play back over Bluetooth and 2.4 GHz. [Hardware results](HARDWARE-TEST.md)

| Environment | Test coverage |
| --- | --- |
| Windows · Chrome | On a physical OE927, the configurator read the keymap over USB, wrote the **Ins → Home** change, verified it by readback and restored the original configuration from a snapshot. |
| Windows · Edge | Tests with a simulated keyboard cover remapping, saving and reopening offline. USB writes to a physical keyboard still need testing. |
| macOS · Chromium | The browser suite runs in CI with a simulated keyboard. USB reads and writes on a physical Mac still need testing. |

Safari and Firefox can browse profiles, display the manual and run the key tester. After the first complete load, the site can reopen offline in the same browser. See the device notes for the layer matrix, macro capacity and stock firmware controls. [Device parameters](PARAMETERS.md) · [Lofree manual](https://cdn.shopify.com/s/files/1/2779/9046/files/Flow2_84_UserManual.pdf?v=1792140117)

## Troubleshooting

- **The keyboard types, but the USB picker is empty.** Switch the standard OE927 to wired mode, connect a USB data cable directly to the computer and open the configurator in desktop Chrome or Edge. Bluetooth and 2.4 GHz carry keystrokes. Configuration uses USB. If you can select the keyboard but the read times out, close any other configurator using it and reconnect.
- **A key still sends its old action after saving.** Check which system and layer you edited. Use **Fn+N** on the physical keyboard for Windows or **Fn+M** for Mac. To test an Fn-layer assignment, hold Fn while pressing the key.
- **Import asks for a FLOW2 Control backup.** The vendor’s VIA layout describes the shape of the keyboard. To move your settings, open **Profiles** in the original browser, export a device backup or the current draft, then use **Choose file** in the new browser.

## Self-hosting

Unzip `flow2-control-web.zip` and serve the directory containing `index.html` from an HTTPS site. Both root and subdirectory deployments work. To use it locally with Python 3, run this command in the extracted directory and open `http://127.0.0.1:8000/` in Chrome or Edge. On macOS the Python command is usually `python3`.

```sh
python -m http.server 8000 --bind 127.0.0.1
```

## Local development

Local development requires Node.js 20 or later.

```sh
git clone https://github.com/hyouo/flow2-control.git
cd flow2-control
npm start
```

Open `http://127.0.0.1:8842/` in your browser. On Windows, you can also double-click `启动 FLOW2.vbs` in the repository. To build a static site for HTTPS hosting, run `npm run build` and deploy the contents of `dist/`.

Run `npm test` for the protocol, editor and local server tests. The browser suite uses a simulated keyboard and a local installation of Chrome.

```sh
npm ci
npm run test:browser
```

## Contributing

Select **Report an issue or test result** on the configurator’s **Device** page to open the form with your app version filled in. Include your model, OS, browser, connection and what happened. The connection log on that page contains the error messages. [File a device report](https://github.com/hyouo/flow2-control/issues/new?template=device-report.yml) · [Existing issues](https://github.com/hyouo/flow2-control/issues)

Hardware reports from Mac users and Windows Edge users are welcome. On a Mac, select Mac mode with **Fn+M** and choose **macOS → Base** in the editor. In Edge on Windows, follow the Windows example above. Note the original mapping, then report the readback after saving, the event from the physical key and whether restoring brought back the original value.

For device changes, start with the VIA transport and its protocol tests. For UI changes, the design notes describe the existing interactions. A screenshot in your pull request helps reviewers see the change. [VIA transport](public/via.js) · [Protocol tests](test/protocol.test.mjs) · [Design notes](DESIGN.md) · [CI](https://github.com/hyouo/flow2-control/actions/workflows/test.yml)

## License

The project code is distributed under the MIT License. The bundled Inter font uses the SIL Open Font License. [MIT](LICENSE) · [Font license](public/fonts/OFL.txt)

The case dimensions follow Lofree’s specifications. The matrix positions and key widths come from Lofree’s `Flow2_84_OE927_ANSI-US_VIA.json`. The static build extracts the `layouts` field from this definition. [Layout file](flow2-84.official.json) · [Lofree Download Center](https://www.lofree.co/pages/download-center) · [Product specifications](https://www.lofree.co/products/flow-2-84-low-profile-mechanical-keyboard)
