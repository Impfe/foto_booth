#!/usr/bin/env bash
# Erzeugt ein selbstsigniertes TLS-Zertifikat fuer certs/.
#
# Safari gibt die Kamera nur in einem "secure context" frei - im WLAN heisst das
# HTTPS. Das Zertifikat traegt alle lokalen IPv4-Adressen dieses Rechners als
# Subject Alternative Name, damit das iPad die Fotobox direkt ueber die IP
# erreichen kann.
set -euo pipefail

cd "$(dirname "$0")/.."
CERT_DIR="${CERT_DIR:-certs}"
DAYS="${DAYS:-825}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl wird benoetigt, ist aber nicht installiert." >&2
  exit 1
fi

mkdir -p "$CERT_DIR"

# Lokale IPv4-Adressen einsammeln (Linux: ip / macOS: ifconfig).
list_addresses() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127\.'
  elif command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n'
  fi
}

ADDRESSES=()
while read -r line; do
  [ -n "$line" ] && ADDRESSES+=("$line")
done < <(list_addresses)

if [ ${#ADDRESSES[@]} -eq 0 ]; then
  echo "Hinweis: keine Netzwerkadresse gefunden - das Zertifikat gilt nur fuer localhost." >&2
fi

SAN="DNS:localhost,IP:127.0.0.1"
for address in ${ADDRESSES[@]+"${ADDRESSES[@]}"}; do
  SAN="$SAN,IP:$address"
done

# Die Erweiterungen kommen aus einer temporaeren Konfiguration statt aus
# -addext: macOS liefert LibreSSL aus, das diese Option je nach Version nicht
# kennt. Ueber die Konfigurationsdatei funktioniert es mit beiden.
CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
cat > "$CONFIG" <<CONF
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_req

[dn]
CN = Fotobox

[v3_req]
subjectAltName = $SAN
basicConstraints = critical,CA:TRUE
keyUsage = critical, digitalSignature, keyCertSign
CONF

LOG="$(mktemp)"
trap 'rm -f "$CONFIG" "$LOG"' EXIT
if ! openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -days "$DAYS" \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -config "$CONFIG" >"$LOG" 2>&1; then
  echo "openssl konnte kein Zertifikat erzeugen:" >&2
  cat "$LOG" >&2
  exit 1
fi

chmod 600 "$CERT_DIR/key.pem"

echo "Zertifikat erstellt:"
echo "  $CERT_DIR/cert.pem"
echo "  $CERT_DIR/key.pem"
echo
echo "Gueltig fuer: $SAN"
echo
echo "Auf dem iPad einmalig vertrauen:"
echo "  1. cert.pem aufs iPad schicken (AirDrop/Mail) und Profil installieren"
echo "  2. Einstellungen > Allgemein > VPN & Geraeteverwaltung > Profil installieren"
echo "  3. Einstellungen > Allgemein > Info > Zertifikatsvertrauenseinstellungen"
echo "     > Schalter fuer 'Fotobox' aktivieren"
