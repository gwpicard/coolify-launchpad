# The server-side tooling, included only when the spec asks for it: Node 22
# from NodeSource and Claude Code. coolify-devops needs Node 18 or newer. Its
# skills are installed in Phase B, over SSH, where a failure can be run again.
#
# This runs after Coolify's installer, and a failure here does not stop the
# script: a server with Coolify and no Node is still worth handing over, and
# Phase B step 6 reads the box back and names what is missing. The commands run
# in a subshell with its own `set -e`, so the first failure ends the subshell
# only. The outer `set -e` is paused around it, because a failing subshell
# would otherwise end the whole script.
#
# Node's own fetches prefer IPv4, for the same dead IPv6 route that makes
# every curl here use -4.
set +e
(
    set -euo pipefail
    curl -4 -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource-setup.sh
    bash /tmp/nodesource-setup.sh
    rm -f /tmp/nodesource-setup.sh
    apt-get -o Acquire::ForceIPv4=true install -y nodejs
    NODE_OPTIONS=--dns-result-order=ipv4first npm install -g @anthropic-ai/claude-code
)
tooling_status=$?
set -e
if [ "$tooling_status" -ne 0 ]; then
    echo "[coolify-launchpad] The tooling (Node 22, Claude Code) did not install, exit $tooling_status. Coolify is unaffected; the launch will report it."
fi
