# goduarte-relay

A small fixed-IP relay. Some vendors (SanMar first) only accept API calls from addresses on an approved list. Our tools run on hosts whose outbound address changes, so they send those calls through this relay, which lives on one DigitalOcean server with a reserved IP.

This repo holds code only. It contains no passwords, tokens or vendor logins; those live on the server in `/etc/goduarte-relay/`.

## Lanes

Each business or client is a **lane** in `relay/lanes.json`. A lane has its own token and a list of the only hosts it may reach. One lane's token cannot reach another lane's hosts, and every request is logged with its lane.

Current lanes:

- `moxie` for Moxie Graphic Productions (SanMar web services).

Anything carrying client case data or other regulated information does not belong on this shared relay; it gets its own server.

## How it works

- `relay/server.mjs` listens on localhost and forwards `<METHOD> /fwd/<host[:port]>/<path>` to `https://<host[:port]>/<path>`.
- Every request needs `Authorization: Bearer <lane token>`. Tokens are generated on the server by `relay/tokens.mjs` and stored in `/etc/goduarte-relay/tokens.json`.
- Caddy serves `https://relay.goduarte.com` with an automatic certificate and passes requests to the relay.
- `GET /health` returns `{"ok":true}` with no token.

## Updates

The server checks this repo every 5 minutes (`goduarte-relay-update.timer`). When `main` has a new commit, it pulls it and re-runs `deploy/install.sh`. Merging a pull request is how a change goes live.

## Adding a lane or a vendor

Add the lane, or the host (with its port if not 443), to `relay/lanes.json` and merge. A new lane's token is created on the server at the next update; read it from the server's web console with:

```
sudo node /opt/goduarte-relay/repo/relay/tokens.mjs /opt/goduarte-relay/repo/relay/lanes.json /etc/goduarte-relay/tokens.json --show <lane>
```

## New server

Create an Ubuntu 24.04 droplet and paste `deploy/cloud-init.yaml` into **User data**. It installs Node, Caddy, the firewall and automatic security updates, then clones this repo and runs `deploy/install.sh`. Attach a reserved IP and point `relay.goduarte.com` at it (DNS only, not proxied).
