# FLOW2 Control

Remap keys, record shortcuts and adjust the backlight on the **Lofree FLOW 2 84** in your browser. It supports the **standard US ANSI model (OE927)**. Your saved key assignments work over Bluetooth and 2.4 GHz when you unplug the cable.

**[Open the configurator in desktop Chrome or Edge](https://hyouo.github.io/flow2-control/)** · [中文](README.md)

## Configure a key

Switch the keyboard to wired mode and plug it into your computer with a USB data cable. Open the configurator, click **Configure via USB** at the top right and choose **Flow2@Lofree**.

Try turning **Ins** into **Home**. Pressing **Ins** will then take you to the start of a line in Windows Notepad.

1. **Pick the key.** Press **Fn+N** on the keyboard to select Windows mode. Choose **Windows → Base** in the app, then click **Ins**, just left of **Del** on the diagram.
2. **Choose what it does.** Click **Home** in the **Keys** list below the diagram.
3. **Click Save to keyboard.** Once saved, click **Test this key** and press the physical **Ins** key. The tester should show **Home**.

![Three arrows point to Ins on the diagram, Home in the list and the Save to keyboard button.](docs/images/remap-en.png)

[Record a one-key copy shortcut](docs/guide.en.md#copy-with-one-key) · [Restore the original key](docs/guide.en.md#restore-a-key) · [Backlight and touch strip](docs/guide.en.md#backlight-and-touch-strip)

## Troubleshooting

**The keyboard types, but the USB picker is empty.** Typing works over Bluetooth and 2.4 GHz. To change a setting, switch to wired mode, connect a USB cable that carries data and click **Configure via USB** again. [More help with connections, remaps and backups](docs/guide.en.md#troubleshooting)

**Remapping on a Mac.** Press **Fn+M** on the keyboard and choose **macOS → Base** in the app. Remapping and restoring have been tested on a physical keyboard in Chrome on Windows. USB reads and writes on Mac and in Edge on Windows still need hardware testing. [Hardware test results](HARDWARE-TEST.md)

## About

I rewrote the driver for my Lofree FLOW 2 simply because the official one sucks.

To report a problem, open **Device → Report an issue or test result** in the app. The form will include your app version. [File a report](https://github.com/hyouo/flow2-control/issues/new?template=device-report.yml)

[Download the site ZIP](https://github.com/hyouo/flow2-control/releases/latest/download/flow2-control-web.zip) · [Open the ZIP locally](docs/guide.en.md#run-the-downloaded-site) · [Run from source](docs/guide.en.md#run-from-source) · [MIT license](LICENSE)
