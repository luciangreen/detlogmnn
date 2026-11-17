#!/bin/sh
# Copies pl2detlog's library (github.com/luciangreen/pl2detlog, built with `node build.js`) into the
# app. Run from this repo with pl2detlog beside it:  sh scripts/vendor-pl2detlog.sh ../pl2detlog
set -e
src="${1:-../pl2detlog}"
(cd "$src" && node build.js >/dev/null)
cp "$src/dist/pl2detlog.js" web/lib/pl2detlog.js
echo "web/lib/pl2detlog.js from pl2detlog $(git -C "$src" rev-parse --short HEAD)"
