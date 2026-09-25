# The server-side tooling, included only when the spec asks for it: Node 22
# from NodeSource and Claude Code. coolify-devops needs Node 18 or newer. Its
# skills are installed in Phase B, over SSH, where a failure can be run again.
# Node's own fetches prefer IPv4, for the same dead IPv6 route that makes
# every curl here use -4.
curl -4 -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource-setup.sh
bash /tmp/nodesource-setup.sh
rm -f /tmp/nodesource-setup.sh
apt-get -o Acquire::ForceIPv4=true install -y nodejs
NODE_OPTIONS=--dns-result-order=ipv4first npm install -g @anthropic-ai/claude-code
