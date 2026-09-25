# Tailscale: install, then join the tailnet as tag:server with Tailscale SSH on.
# A failure here stops the script. A box that missed the tailnet cannot be
# reached by name, and the launch has to say so rather than carry on.
curl -4 -fsSL https://tailscale.com/install.sh | sh
TAILSCALE_KEY="$(printf '%s' '{{TAILSCALE_KEY_B64}}' | base64 -d)"
tailscale up --authkey="$TAILSCALE_KEY" --ssh \
    --advertise-tags=tag:server --hostname={{SERVER_NAME}}
unset TAILSCALE_KEY
