# Tailscale: install, then join the tailnet as tag:server with Tailscale SSH on.
# A failure here stops the script. A box that missed the tailnet cannot be
# reached by name, and the launch has to say so rather than carry on.
#
# The key goes through a mode 600 file rather than the command line, where any
# process could read it from the process list. The file is removed on the way
# out, whether tailscale up worked or not.
curl -4 -fsSL https://tailscale.com/install.sh | sh
install -d -m 700 /run/coolify-launchpad
TAILSCALE_KEY_FILE=/run/coolify-launchpad/tailscale-auth-key
trap 'rm -f "$TAILSCALE_KEY_FILE"' EXIT
(umask 077 && printf '%s' '{{TAILSCALE_KEY_B64}}' | base64 -d > "$TAILSCALE_KEY_FILE")
tailscale up --auth-key="file:$TAILSCALE_KEY_FILE" --ssh \
    --advertise-tags=tag:server --hostname={{SERVER_NAME}}
rm -f "$TAILSCALE_KEY_FILE"
