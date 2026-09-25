set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Every apt fetch goes over IPv4. A dead IPv6 route on a Hetzner image has hung
# package fetches before. The file makes it hold for the installers that run
# apt later in this script, not only for the lines below.
echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4

# On first boot, unattended-upgrades often holds the apt lock. Wait for it for
# up to five minutes instead of failing, here and in the installers after us.
echo 'DPkg::Lock::Timeout "300";' > /etc/apt/apt.conf.d/99lock-timeout

apt-get -o Acquire::ForceIPv4=true update
apt-get -o Acquire::ForceIPv4=true -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get -o Acquire::ForceIPv4=true install -y curl git jq
