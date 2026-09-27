# Tuiss SmartView BLE for Homey Pro

An experimental Homey SDK v3 app that controls Tuiss SmartView blinds locally over Bluetooth Low Energy (BLE). It does not require a separate remote control.

The app recognizes these advertised device names from Tuiss2HA: TS3000, TS5200, TS5300, TS2600, TS2900, TS5001, and TS5101. MRM-G2 and MHC-G2 are also included as possible names, although the model printed on a motor does not necessarily match its BLE advertisement. If the scan finds no recognized names, the pairing screen lists other connectable BLE devices so you can identify your motor by its address. Only select a device you can positively identify as your motor. The motor must be within Bluetooth range of your Homey Pro.

## Install and pair

1. Make sure the motor already works in the Tuiss SmartView phone app. For the initial test, place the Homey Pro near the motor and close the phone app.
2. Extract the ZIP file on your computer. Install Node.js and the Homey CLI with `npm install -g homey`.
3. Open a terminal in the extracted `tuiss-homey` directory and run `npm install`.
4. Sign in to the Homey CLI with `homey login`. A browser window opens: sign in with the **same Homey account that owns or can access your Homey Pro** and authorize the CLI. If no browser opens, copy the URL shown in the terminal into your browser. You do not need to enter your Homey password in the terminal.
5. Run `homey select` and choose your Homey Pro from the list. If you have several Homeys, check your choice with `homey select current`. Your CLI sign-in and selected Homey are remembered for later updates; you normally only need to repeat these steps if you change accounts or Homeys.
6. Run `npx homey app install` **from the `tuiss-homey` directory** to install the app on the selected Homey. Do not use `--clean` when updating an existing installation.
7. In the Homey app, select **Add device → Tuiss SmartView BLE → SmartView blind**, then select your motor.
8. Test fully open and fully closed, then a middle position and Stop. If open and closed are reversed compared with the phone app, open the motor's **Advanced settings** in Homey and enable **Reverse direction**. This also works for an already paired motor.

## Connection behavior and limitations

Version 0.1.7 retains the reconnection behavior tested with the TS5200 in version 0.1.5. The app releases the BLE connection after a command, normally after eight seconds or three seconds after receiving the target position. It also cleans up a connection dropped by the motor and scans again for the next command. The **Reverse direction** setting reverses commands, incoming position updates, and the position already shown in Homey.

Position changes made in the Tuiss phone app are not automatically reflected in Homey. Bluetooth range, characteristics, notifications, and pairing may vary by motor. Homey Bridge as a BLE satellite has not been tested.

To update an existing installation, run `npx homey app install` from the extracted `tuiss-homey` directory; do not use `--clean`. For live BLE logs, temporarily run `npx homey app run --remote` and issue a command in Homey. After stopping the debug run, reinstall the app with `npx homey app install`.

## Attribution and license

Protocol commands and supported model names are adapted from [pink88/Tuiss2HA](https://github.com/pink88/Tuiss2HA), licensed under GNU GPL v3. This derivative app is licensed under GPL-3.0-only. See `LICENSE` and the Tuiss2HA source for attribution. This is not an official Tuiss or Homey app.
