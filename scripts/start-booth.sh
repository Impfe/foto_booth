#!/usr/bin/env bash
# Startet die Fotobox fuer den Abend und haelt sie am Laufen.
#
# Zwei Dinge, die sonst mitten in der Feier passieren:
#   - der Rechner schlaeft ein und nimmt den Server mit  -> caffeinate
#   - node stuerzt ab und niemand merkt es               -> Neustartschleife
#
# Beenden mit Strg+C.
set -uo pipefail

cd "$(dirname "$0")/.."

RUN=(npm start)
if command -v caffeinate >/dev/null 2>&1; then
  # macOS: haelt den Rechner wach, solange der Server laeuft.
  RUN=(caffeinate -i npm start)
  echo "Ruhezustand ist deaktiviert, solange die Fotobox laeuft."
else
  echo "Hinweis: caffeinate nicht gefunden - bitte den Ruhezustand selbst abschalten."
fi

trap 'echo; echo "Fotobox beendet."; exit 0' INT TERM

FAST_FAILURES=0

while true; do
  STARTED_AT=$SECONDS
  "${RUN[@]}"
  STATUS=$?
  RAN_FOR=$((SECONDS - STARTED_AT))

  # 0 und 130 (Strg+C) sind gewollte Stopps.
  if [ $STATUS -eq 0 ] || [ $STATUS -eq 130 ]; then
    echo "Fotobox beendet."
    exit 0
  fi

  # Sofortige Abstuerze hintereinander bedeuten einen echten Fehler -
  # dann lieber anhalten als in einer Schleife heisslaufen.
  if [ $RAN_FOR -lt 5 ]; then
    FAST_FAILURES=$((FAST_FAILURES + 1))
  else
    FAST_FAILURES=0
  fi

  if [ $FAST_FAILURES -ge 5 ]; then
    echo
    echo "Der Server ist fuenfmal hintereinander sofort abgestuerzt - Abbruch." >&2
    echo "Die Meldung oben zeigt, woran es liegt (haeufig: Port belegt)." >&2
    exit 1
  fi

  echo
  echo "Server beendet (Code $STATUS) - Neustart in 2 Sekunden ..."
  sleep 2
done
