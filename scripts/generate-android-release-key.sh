#!/usr/bin/env bash
# AWLAD SELIM - Production Android Release Keystore Generator (RSA 4096-bit)
# Stores keystore, backup copy, and Base64 export strictly OUTSIDE the project repository.
# NEVER commit keystore files, passwords, or *.b64 files to GitHub!

set -euo pipefail

ROTATE_NEW=false
OUTPUT_DIR=""
for arg in "$@"; do
  case "$arg" in
    --rotate)
      ROTATE_NEW=true
      ;;
    --help|-h)
      echo "Usage: $0 [--rotate] [OUTPUT_DIR]"
      exit 0
      ;;
    *)
      if [ -z "$OUTPUT_DIR" ]; then
        OUTPUT_DIR="$arg"
      fi
      ;;
  esac
done

OUTPUT_DIR="${OUTPUT_DIR:-$HOME/.awlad-selim-keys}"
BACKUP_DIR="$OUTPUT_DIR/backups"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-AWLAD-SELIM}"
VALIDITY_DAYS=10000
DNAME="/CN=AWLAD SELIM ERP/OU=Mobile Engineering/O=AWLAD SELIM/L=Cairo/ST=Cairo/C=EG"
KEYTOOL_DNAME="CN=AWLAD SELIM ERP, OU=Mobile Engineering, O=AWLAD SELIM, L=Cairo, ST=Cairo, C=EG"

if [ "${KEY_ALIAS,,}" = "androiddebugkey" ]; then
  echo "ERROR: Refusing to use androiddebugkey for Production Release signing." >&2
  exit 1
fi

case "$OUTPUT_DIR" in
  "$(pwd)"* )
    echo "ERROR: Refusing to create production keystore inside the project directory ($OUTPUT_DIR)." >&2
    exit 1
    ;;
esac

mkdir -p "$OUTPUT_DIR" "$BACKUP_DIR"
chmod 700 "$OUTPUT_DIR" "$BACKUP_DIR"

KEYSTORE_PATH="$OUTPUT_DIR/AWLAD-SELIM-Release.jks"
STAMP=$(date +%Y%m%d_%H%M%S)
if [ -e "$KEYSTORE_PATH" ]; then
  if [ "$ROTATE_NEW" = "true" ]; then
    ARCHIVED_OLD="$BACKUP_DIR/AWLAD-SELIM-OLD-ARCHIVED-$STAMP.jks"
    mv "$KEYSTORE_PATH" "$ARCHIVED_OLD"
    chmod 600 "$ARCHIVED_OLD"
    echo "[OK] Archived previous keystore to: $ARCHIVED_OLD"
  else
    echo "ERROR: Refusing to overwrite existing keystore at $KEYSTORE_PATH (pass --rotate to archive the old key and create a brand-new independent production key)." >&2
    exit 1
  fi
fi

gen_pw() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 28
  else
    head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28
  fi
}

STORE_PW="$(gen_pw)"
KEY_PW="$STORE_PW"

if command -v keytool >/dev/null 2>&1; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE_PATH" \
    -storetype PKCS12 \
    -keyalg RSA \
    -keysize 4096 \
    -validity "$VALIDITY_DAYS" \
    -alias "$KEY_ALIAS" \
    -storepass "$STORE_PW" \
    -keypass "$KEY_PW" \
    -dname "$KEYTOOL_DNAME"
  SHA256_FP=$(keytool -list -v -keystore "$KEYSTORE_PATH" -storepass "$STORE_PW" -alias "$KEY_ALIAS" | awk -F'SHA256: ' '/SHA256:/{print $2; exit}')
elif command -v openssl >/dev/null 2>&1; then
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT
  openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout "$TMP_DIR/release.key" \
    -out "$TMP_DIR/release.crt" \
    -days "$VALIDITY_DAYS" \
    -subj "$DNAME" >/dev/null 2>&1
  openssl pkcs12 -export \
    -in "$TMP_DIR/release.crt" \
    -inkey "$TMP_DIR/release.key" \
    -name "$KEY_ALIAS" \
    -out "$KEYSTORE_PATH" \
    -passout "pass:$STORE_PW"
  SHA256_FP=$(openssl x509 -in "$TMP_DIR/release.crt" -noout -fingerprint -sha256 | sed 's/^.*=//')
else
  echo "ERROR: Neither JDK keytool nor OpenSSL is installed." >&2
  exit 1
fi

chmod 600 "$KEYSTORE_PATH"
BACKUP_PATH="$BACKUP_DIR/AWLAD-SELIM-Release-$STAMP.jks"
cp "$KEYSTORE_PATH" "$BACKUP_PATH"
chmod 600 "$BACKUP_PATH"

B64_PATH="$OUTPUT_DIR/ANDROID_KEYSTORE_BASE64.txt"
base64 < "$KEYSTORE_PATH" | tr -d '\n' > "$B64_PATH"
chmod 600 "$B64_PATH"

LOCAL_PROPS_PATH="$OUTPUT_DIR/keystore.properties"
cat > "$LOCAL_PROPS_PATH" <<EOF
storeFile=$KEYSTORE_PATH
storePassword=$STORE_PW
keyAlias=$KEY_ALIAS
keyPassword=$KEY_PW
EOF
chmod 600 "$LOCAL_PROPS_PATH"

SECRETS_REF="$OUTPUT_DIR/GITHUB_SECRETS_REFERENCE.txt"
cat > "$SECRETS_REF" <<EOF
AWLAD SELIM - Android Production Release Secrets (KEEP OUTSIDE GIT / GITHUB)
============================================================================
Keystore File        : $KEYSTORE_PATH
External Backup      : $BACKUP_PATH
Base64 Export File   : $B64_PATH
Local Gradle Props   : $LOCAL_PROPS_PATH
Certificate SHA-256  : ${SHA256_FP:-unavailable}

Configure these 4 GitHub Actions Secrets (Settings -> Secrets -> Actions):
1. ANDROID_KEYSTORE_BASE64   = <contents of $B64_PATH>
2. ANDROID_KEYSTORE_PASSWORD = $STORE_PW
3. ANDROID_KEY_ALIAS         = $KEY_ALIAS
4. ANDROID_KEY_PASSWORD      = $KEY_PW

Local Release Build (APK + AAB) without committing secrets:
  cp "$LOCAL_PROPS_PATH" android/keystore.properties
  (or export AWLAD_ANDROID_KEYSTORE_PATH, AWLAD_ANDROID_KEYSTORE_PASSWORD, AWLAD_ANDROID_KEY_ALIAS, AWLAD_ANDROID_KEY_PASSWORD)

IMPORTANT:
- Keep $KEYSTORE_PATH and $BACKUP_PATH safe for ALL future releases and updates.
- Never upload this file, $KEYSTORE_PATH, android/keystore.properties, or Base64 output to GitHub or any shared repo.
- Previously installed Debug/old-key APKs cannot be upgraded in-place; users must sync pending operations, uninstall old APK manually once, then install the new Production APK.
EOF
chmod 600 "$SECRETS_REF"

echo "[OK] Keystore created outside project : $KEYSTORE_PATH"
echo "[OK] Backup created outside project   : $BACKUP_PATH"
echo "[OK] Base64 saved outside project     : $B64_PATH"
echo "[OK] Local Gradle properties saved    : $LOCAL_PROPS_PATH"
echo "[OK] Secrets & SHA-256 reference      : $SECRETS_REF"
echo "Certificate SHA-256 Fingerprint       : ${SHA256_FP:-unavailable}"
