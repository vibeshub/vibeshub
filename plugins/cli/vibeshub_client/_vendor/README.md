# Vendored dependencies

These packages are copied verbatim into the plugin so it needs no install step
(the hook and `share-pr` command run a bare `python3` with `vibeshub_client` on
`sys.path`).

## truststore 0.10.4

- Source: https://pypi.org/project/truststore/ (MIT, see `truststore/LICENSE`)
- Why: verifies TLS certificates against the native OS trust store, so uploads
  succeed on networks behind a TLS-intercepting proxy/VPN whose root CA the OS
  trusts but Python's bundled CA store does not.
- Requires Python >= 3.10; importing it on 3.9 raises `ImportError`, which the
  caller in `upload.py` handles by falling back to a keychain/cert-store scrape.

To update: `pip download truststore --no-deps`, unzip the wheel, and replace
`truststore/*.py` + `LICENSE`.
