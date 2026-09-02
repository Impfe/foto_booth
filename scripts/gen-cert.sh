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
  [ -n "$address" ] && SAN="$SAN,IP:$address"
done

openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -days "$DAYS" \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -subj "/CN=Fotobox" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:TRUE" \
  >/dev/null 2>&1

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
