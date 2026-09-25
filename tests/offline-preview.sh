#!/usr/bin/env sh
# offline-preview.sh: run `pulumi preview` on the program with stand-in
# secrets, so the program is shown to build its resources without creating
# anything or reaching Hetzner, Tailscale or Pulumi Cloud.
#
# How it stays offline:
#   - the state lives in a throwaway folder (a file:// backend), not Pulumi Cloud;
#   - HCLOUD_ENDPOINT points at a closed port on this computer, so any call the
#     Hetzner provider tried to make would fail here rather than leave it;
#   - the token, passphrase and auth key are made-up markers.
# The first run downloads the provider plugins, which come from the providers'
# own release pages. Nothing else leaves this computer.
#
# It runs on a copy of the program, so no stack file lands in program/.
# It is not part of `npm run check`, because CI has no Pulumi CLI.

set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v pulumi >/dev/null 2>&1 || { echo "offline-preview: the pulumi command is not on the path"; exit 2; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/coolify-launchpad-preview.XXXXXX")
trap 'rm -rf "$WORK"' EXIT INT TERM

mkdir -p "$WORK/repo/servers" "$WORK/state"
cp -R "$ROOT/program" "$ROOT/lib" "$ROOT/package.json" "$WORK/repo/"
cp "$ROOT/servers/example.yaml" "$WORK/repo/servers/"
ln -s "$ROOT/node_modules" "$WORK/repo/node_modules"

export PULUMI_BACKEND_URL="file://$WORK/state"
export PULUMI_SKIP_UPDATE_CHECK=true
export PULUMI_CONFIG_PASSPHRASE=offline-preview-marker
# The Hetzner provider checks the token is 64 characters before it will start.
export HCLOUD_TOKEN=offlinepreviewmarkeroffline0previewmarkeroffline0previewmarker00
export HCLOUD_ENDPOINT=http://127.0.0.1:9/v1
export TAILSCALE_AUTH_KEY=offline-preview-marker-key
export SERVER=example

cd "$WORK/repo/program"
pulumi stack init example --secrets-provider passphrase --non-interactive >/dev/null
pulumi preview --stack example --non-interactive --diff > "$WORK/preview.txt" 2>&1 || {
  cat "$WORK/preview.txt"; echo "offline-preview: FAILED"; exit 1; }

fail=0
expect() {
  if grep -q -- "$1" "$WORK/preview.txt"; then echo "ok: $2"; else echo "FAIL: $2"; fail=1; fi
}
refuse() {
  if grep -q -- "$1" "$WORK/preview.txt"; then echo "FAIL: $2"; fail=1; else echo "ok: $2"; fi
}
expect 'hcloud:index/server:Server: (create)' 'the server is planned'
expect 'serverType *: "cpx32"' 'with the spec'\''s type'
expect 'location *: "nbg1"' 'in the spec'\''s location'
expect 'image *: "ubuntu-24.04"' 'on Ubuntu 24.04'
expect 'hcloud:index/firewall:Firewall: (create)' 'the firewall is planned'
expect 'name *: "coolify"' 'named coolify'
expect 'port *: "22"' 'with inbound 22'
expect 'hcloud:index/sshKey:SshKey: (create)' 'the SSH key is planned'
expect 'tls:index/privateKey:PrivateKey: (create)' 'the key pair is planned'
expect 'userData *: \[secret\]' 'user-data is kept secret in the plan'
refuse 'offline-preview-marker-key' 'the auth key does not appear in the plan'
refuse 'direction *: "out"' 'there are no outbound rules'
[ "$(grep -c 'direction *: "in"' "$WORK/preview.txt")" -eq 1 ] && echo "ok: exactly one inbound rule" || { echo "FAIL: not exactly one inbound rule"; fail=1; }

if [ "$fail" -ne 0 ]; then cat "$WORK/preview.txt"; echo "offline-preview: FAILED"; exit 1; fi
echo "offline-preview: passed"
