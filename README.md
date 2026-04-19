# Fordon RP x KomisariatPolicji

Bot Discord i panel webowy do mandatow, aresztow i kartoteki policyjnej.

## Co potrafi

- mandaty z prywatnym kanalem sprawy
- areszty i pojscia do wiezienia
- kartoteka policyjna z automatycznym zapisem wpisow
- panel webowy z live odswiezaniem, edycja i recznym przyciskiem `Odswiez`

## Komendy

- `/ustawkanaldomandatow komendy:#kanal informacje:#kanal`
- `/mandatyperrmison akcja:list|dodaj|usun rola:@rola uzytkownik:@gracz`
- `/mandat kto:@policjant komu:@gracz kwota:1000 powod:"Powod"`
- `/arrestkanal komendy:#kanal informacje:#kanal`
- `/arrestperrmison akcja:list|dodaj|usun rola:@rola uzytkownik:@gracz`
- `/arrest kto:@policjant komu:@gracz powod:"Powod" rodzaj:areszt|wiezienie czas:"30 minut"`

## Wymagane ENV

- `DISCORD_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_CLIENT_SECRET`
- `GUILD_ID`
- `PORT`

## Opcjonalne ENV

- `PANEL_ADMIN_KEY` - jesli ustawisz, panel webowy bedzie pytal o klucz
- `PANEL_BASE_URL` - adres panelu, potrzebny do logowania przez Discord, np. `http://localhost:3000`

## Start

```powershell
npm.cmd install
npm.cmd start
```

## Panel webowy

Po uruchomieniu bot wystawia panel na:

```text
http://localhost:3000
```

Jesli na Railway ustawisz `PORT`, aplikacja i bot beda dzialac razem w jednym procesie.
