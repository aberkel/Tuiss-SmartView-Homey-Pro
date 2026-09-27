# Tuiss SmartView BLE voor Homey Pro

Experimentele Homey SDK v3-app voor lokale Bluetooth LE-bediening van Tuiss SmartView-motoren. Herkende BLE-namen volgens Tuiss2HA: TS3000, TS5200, TS5300, TS2600, TS2900, TS5001 en TS5101. Naar aanleiding van het motorlabel MRM-G2 zijn MRM-G2 en MHC-G2 ook toegevoegd als mogelijke BLE-namen. Het label bewijst niet onder welke naam de motor daadwerkelijk adverteert. Als geen herkenbare naam wordt gevonden, toont de zoeklijst alle bereikbare BLE-apparaten om het adres met de QR-sticker op de motor te vergelijken. Selecteer dan alleen jouw motor. De app koppelt motoren die binnen Bluetooth-bereik van de Homey Pro zijn. Een losse afstandsbediening is niet nodig.

## Installeren en proberen

1. Zorg dat de motor al werkt in de Tuiss SmartView-app. Plaats Homey Pro tijdelijk dichtbij de motor en sluit de telefoon-app tijdens de eerste test.
2. Pak het zipbestand uit op een computer. Installeer Node.js en de Homey CLI: `npm install -g homey`.
3. Open een terminal in de map `tuiss-homey` en voer `npm install` en `homey login` uit.
4. Voer `homey app install` uit om de app op je Homey te installeren.
5. Open de Homey-app, kies Apparaat toevoegen → Tuiss SmartView BLE → SmartView raamdecoratie, en selecteer de gevonden motor.
6. Test eerst volledig open en volledig dicht, daarna 50% en stop. Is de richting andersom dan op de telefoon, open de apparaatinstellingen van de motor in Homey → Geavanceerde instellingen en zet **Richting omkeren** aan. Dat werkt ook voor een bestaande koppeling.

De app houdt de BLE-verbinding tijdens de beweging open voor stopcommando's en positie-updates. Een positiewijziging in de Tuiss-telefoonapp wordt niet automatisch bijgewerkt in Homey. Bluetooth-bereik, service-discovery, notificaties en pairing moeten met jouw echte motor worden gevalideerd; zonder motor is dit een prototype. Homey Bridge als BLE-satelliet is niet getest.

Versie 0.1.7 bouwt verder op de herverbinding die bij de TS5200 met versie 0.1.5 in de praktijk werkte. De verbinding wordt na een opdracht weer vrijgegeven (normaal na acht seconden; na een gemelde eindpositie na drie seconden). De optie **Richting omkeren** verandert opdrachten, positieterugmeldingen en de al getoonde stand. Een bestaande motor hoeft hiervoor niet opnieuw te worden gekoppeld. Installeer met `npx homey app install` in dezelfde map. Voor live BLE-logs gebruik je tijdelijk `npx homey app run --remote` zonder `--clean` en installeer je na de debugrun weer met `app install`.

## Herkomst en licentie

Protocolcommando's en ondersteunde modelnamen zijn afgeleid van [pink88/Tuiss2HA](https://github.com/pink88/Tuiss2HA) (GNU GPL v3). Deze afgeleide app wordt onder GPL-3.0-only aangeboden; zie LICENSE en de broncode van Tuiss2HA voor toeschrijving. Geen officiële Tuiss- of Homey-app.
