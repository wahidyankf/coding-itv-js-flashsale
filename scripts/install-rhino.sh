#!/bin/sh
# Install the pinned RHINO binary into .tools/rhino.
# Bump RHINO_VERSION and the digests together, from the release's checksums.txt.
# The archive is checked against the digests below before it is extracted.
set -eu

RHINO_VERSION=v0.16.7

case "$(uname -s)-$(uname -m)" in
	Darwin-arm64) TARGET=aarch64-apple-darwin; SHA256=a926e89e8da0676c0a66016d173bff946ce27de0cae4254017475b3d19d17f6d ;;
	Darwin-x86_64) TARGET=x86_64-apple-darwin; SHA256=ba7e693bbe91d81a0d0da3f4c2201878b1493aa3f980f785eae095222cb17418 ;;
	Linux-x86_64) TARGET=x86_64-unknown-linux-gnu; SHA256=2258d4e94afa474cf007f926e620365004969bd8dc539bea49f5e4bc6ef689b4 ;;
	Linux-aarch64 | Linux-arm64) TARGET=aarch64-unknown-linux-gnu; SHA256=38e78f8b0ec90b587a9fd15b315aba0537bbefa6e5bb0d20f80664e706b023ac ;;
	*) echo "rhino: no pinned build for $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

if [ -x .tools/rhino ] && .tools/rhino version --json 2>/dev/null | grep -q "\"version\":\"$RHINO_VERSION\""; then
	echo "rhino $RHINO_VERSION already installed at .tools/rhino"
	exit 0
fi

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	else
		shasum -a 256 "$1" | cut -d ' ' -f 1
	fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ARCHIVE="rhino-$TARGET.tar.gz"
curl -fsSL -o "$TMP/$ARCHIVE" "https://github.com/wahidyankf/rhino/releases/download/$RHINO_VERSION/$ARCHIVE"

ACTUAL=$(sha256_of "$TMP/$ARCHIVE")
if [ "$ACTUAL" != "$SHA256" ]; then
	echo "rhino: checksum mismatch for $ARCHIVE" >&2
	echo "  expected $SHA256" >&2
	echo "  actual   $ACTUAL" >&2
	exit 1
fi

tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
mkdir -p .tools
install -m 0755 "$TMP/rhino" .tools/rhino
.tools/rhino version
