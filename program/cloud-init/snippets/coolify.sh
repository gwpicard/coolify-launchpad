# Coolify's own installer. It installs Docker and starts Coolify on port 8000.
# No admin account is created here: that would put a password in user-data,
# which any process on the box can read from the metadata service. The person
# registers the admin over the tailnet in Phase B.
curl -4 -fsSL https://cdn.coollabs.io/coolify/install.sh | bash -s {{COOLIFY_VERSION_ARG}}
