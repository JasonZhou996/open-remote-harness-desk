#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
SDK_ROOT="${CODEX_ANDROID_SDK:-${HOME}/.local/share/codex-android-sdk}"
TOOLS="${SDK_ROOT}/build-tools/android-15"
PLATFORM="${SDK_ROOT}/platform/android-35/android.jar"
if [ ! -f lib/webkit-1.5.0.jar ]; then
    python3 - <<'DOWNLOAD_WEBKIT'
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile
from io import BytesIO
import hashlib
archive = urlopen('https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/1.5.0/webkit-1.5.0.aar', timeout=30).read()
if hashlib.sha256(archive).hexdigest() != '1efb532405223883d8a451b2cd07da49ae30ed22c2a801b532beea647de3d398':
    raise SystemExit('AndroidX WebKit archive checksum mismatch')
Path('lib').mkdir(exist_ok=True)
Path('lib/webkit-1.5.0.jar').write_bytes(ZipFile(BytesIO(archive)).read('classes.jar'))
DOWNLOAD_WEBKIT
fi
mkdir -p build/classes build/dex dist
java com.sun.tools.javac.Main -source 8 -target 8 -classpath "$PLATFORM:lib/webkit-1.5.0.jar" -d build/classes src/local/codex/lan/*.java
java com.sun.tools.javac.Main -source 8 -target 8 -classpath build/classes -d build/check AddressCheck.java
java -ea -cp build/classes:build/check local.codex.lan.AddressCheck
java -cp "$TOOLS/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 26 --lib "$PLATFORM" --output build/dex build/classes/local/codex/lan/*.class lib/webkit-1.5.0.jar
"$TOOLS/aapt2" compile --dir res -o build/resources.zip
"$TOOLS/aapt2" link -o build/unsigned.apk --manifest AndroidManifest.xml -I "$PLATFORM" build/resources.zip
python3 - <<'PY'
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
with ZipFile('build/unsigned.apk', 'a') as apk:
    apk.write('build/dex/classes.dex', 'classes.dex', compress_type=ZIP_DEFLATED)
    for asset in Path('assets').glob('*'):
        apk.write(asset, str(asset), compress_type=ZIP_DEFLATED)
PY
"$TOOLS/zipalign" -P 16 -f 4 build/unsigned.apk build/aligned.apk
if [ ! -f signing.jks ]; then
    keytool -genkeypair -keystore signing.jks -alias local -storepass android -keypass android -dname 'CN=Codex LAN Local' -keyalg RSA -keysize 2048 -validity 10000
    chmod 600 signing.jks
fi
java -jar "$TOOLS/lib/apksigner.jar" sign --ks signing.jks --ks-key-alias local --ks-pass pass:android --key-pass pass:android --out dist/Codex-LAN-1.14.apk build/aligned.apk
java -jar "$TOOLS/lib/apksigner.jar" verify --verbose dist/Codex-LAN-1.14.apk
"$TOOLS/aapt2" dump badging dist/Codex-LAN-1.14.apk
sha256sum dist/Codex-LAN-1.14.apk
