# Phase B polls this file, and `cloud-init status`, to know Phase A finished.
install -d /var/lib/coolify-launchpad
touch /var/lib/coolify-launchpad/phase-a-done
echo "[coolify-launchpad] Phase A (cloud-init) complete. Waiting for Phase B over SSH."
