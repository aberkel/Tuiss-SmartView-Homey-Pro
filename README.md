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
7. In the Homey app, select **Add device → Tuiss SmartView BLE → SmartView blind**, then select your motor. Follow the illustrated pairing guide below.
8. Test fully open and fully closed, then a middle position and Stop. If open and closed are reversed compared with the phone app, open the motor's **Advanced settings** in Homey and enable **Reverse direction**. This also works for an already paired motor.

## Pairing guide

The screenshots show a **Tuiss TS5200**. Other motors may advertise a different name or use a different pairing procedure. Keep your Homey Pro within Bluetooth range, and close the Tuiss phone app before pairing.

1. In Homey, add a Tuiss SmartView BLE device and choose **SmartView blind**.

   ![Choose the SmartView blind device type in Homey](docs/images/01-choose-blind.png)

2. Tap **Connect**. Press and hold the button on the blind's motor for about **four seconds**. The blind moves briefly to acknowledge the button press and becomes discoverable for a short time. If the scan misses it, repeat this step.

   ![Connect screen for the SmartView blind](docs/images/02-connect.png)

3. Select the motor that Homey finds and tap **Continue**. This example appears as **Tuiss TS5200**; confirm it is your own motor before continuing.

   ![A Tuiss TS5200 found by Homey](docs/images/03-found-device.png)

4. Choose a name and zone, then tap **Finish**.

   ![Choose the motor name and zone](docs/images/04-name-and-zone.png)

5. Homey shows the available Flow cards after pairing. Tap **Got it** to finish.

   ![Flow cards offered after pairing](docs/images/05-flow-cards.png)

## Controls and direction

Open the paired device in Homey to move the blind and set a position. The screen below shows the device controls.

![Blind controls in the Homey app](docs/images/06-controls.png)

If Homey opens the blind when the Tuiss phone app closes it, open the device's **Advanced settings** and select **Reverse direction**. Enable the switch and save the setting. This swaps open and closed as well as the displayed position; it does not change the motor's hardware calibration.

![Reverse direction in advanced settings](docs/images/07-advanced-settings.png)

![Enable the Reverse direction switch](docs/images/08-reverse-direction.png)

These screenshots are part of this source package and illustrate the mobile app; Homey's App Store `README.txt` is plain text and will not display embedded images.

## Connection behavior and limitations

Version 0.1.8 retains the reconnection behavior tested with the TS5200 in version 0.1.5. The app releases the BLE connection after a command, normally after eight seconds or three seconds after receiving the target position. It also cleans up a connection dropped by the motor and scans again for the next command. The **Reverse direction** setting reverses commands, incoming position updates, and the position already shown in Homey.

Homey acknowledges a control request immediately because discovering and connecting over BLE can take more than ten seconds. The command continues in the background, in order. If connecting or writing ultimately fails after retries, a warning appears on the device in Homey; a later successful command clears the warning. A successful BLE write does not prove that the blind has finished moving.

Position changes made in the Tuiss phone app are not automatically reflected in Homey. Bluetooth range, characteristics, notifications, and pairing may vary by motor. Homey Bridge as a BLE satellite has not been tested.

To update an existing installation, run `npx homey app install` from the extracted `tuiss-homey` directory; do not use `--clean`. For live BLE logs, temporarily run `npx homey app run --remote` and issue a command in Homey. After stopping the debug run, reinstall the app with `npx homey app install`.

## Attribution and license

Protocol commands and supported model names are adapted from [pink88/Tuiss2HA](https://github.com/pink88/Tuiss2HA), licensed under GNU GPL v3. This derivative app is licensed under GPL-3.0-only. See `LICENSE` and the Tuiss2HA source for attribution. This is not an official Tuiss or Homey app.
