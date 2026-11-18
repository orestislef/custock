# deploy

Custock runs on one server: the api, the web, and litestream copying the database to an S3
compatible bucket (Cloudflare R2). Everything here is done by hand over ssh. There is no CI/CD and
no GitHub Actions on purpose.

| file | what |
|------|------|
| `api.Dockerfile` | the api: node 22 slim, runs as the `node` user, database and uploads in the `/data` volume |
| `web.Dockerfile` | the web as a Next.js standalone server |
| `docker-compose.yml` | api, web and litestream together, ports bound to 127.0.0.1 only |
| `litestream.yml` | continuous backup of `/data/custock.db` to the bucket |
| `env.example` | every setting, copy it to `.env` |
| `custock-api.service` | the systemd unit, for running the api without docker |
| `../scripts/db-snapshot.mjs` | nightly `VACUUM INTO` snapshot, keeps the newest 30 |
| `../scripts/db-restore-check.mjs` | the monthly restore test |

## settings

All in `deploy/.env` (start from `env.example`).

| var | needed | what |
|-----|--------|------|
| `CUSTOCK_JWT_SECRET` | yes | 32+ random characters. the api refuses to start without it outside dev |
| `CUSTOCK_UNSUB_SECRET` | recommended | key for unsubscribe links, derived from the jwt secret when missing |
| `CUSTOCK_PUBLIC_WEB_URL` | yes | where the web lives, used in join, confirm, invite and unsubscribe links |
| `CUSTOCK_API_URL` | yes | the api's public address, used for files it serves itself |
| `CUSTOCK_CORS` | yes | the web origin |
| `CUSTOCK_TRUSTED_PROXY` | behind a proxy | `1` so the client address is the rightmost `X-Forwarded-For` hop |
| `CUSTOCK_TURNSTILE_SECRET` | for public signups | without it the join page refuses signups outside dev |
| `CUSTOCK_AUTH_MODE` | | `local` (built in login) or `jwks` (the real login server) |
| `CUSTOCK_AUTH_JWKS_URL`, `CUSTOCK_AUTH_ISSUER`, `CUSTOCK_AUTH_AUDIENCE` | with `jwks` | the login server's key set, issuer and audience |
| `CUSTOCK_TRANSPORT` | | `outbox` (default, nothing leaves the server) or `live` |
| `CUSTOCK_ALLOW_SENDING` | with `live` | must be `yes`, on purpose a separate switch |
| `CUSTOCK_FCM_SERVICE_ACCOUNT` | with `live` | path to the Firebase service account json (put it in `/data/secrets`) |
| `CUSTOCK_SMTP_URL`, `CUSTOCK_MAIL_FROM` | with `live` | the mail server and our sender address |
| `CUSTOCK_SEED` | first start only | `1` puts the made up Lemoni business in an empty database |
| `CUSTOCK_DEV` | never on a server | dev features |
| `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` | yes | the R2 bucket and an API token for it |

## one container behind an existing proxy

The setup in use: the api and the web in one image (`Dockerfile`, `start.mjs`), one container,
behind the reverse proxy the server already has, on **its own subdomain** (for example
`custock.example.com`). Its own origin matters: on a path of a shared domain every other app on that
domain could read the app's sign in tokens and share its notification permission. The server keeps
no source code: `ship.sh` sends the committed code over ssh, builds the image there, then removes
the source and the build cache.

| file | what |
|------|------|
| `Dockerfile` | api and web together, the web built for `CUSTOCK_BASE_PATH` (empty on its own subdomain) |
| `start.mjs` | starts the api, then the web once the api answers, stops both together |
| `compose.server.yml` | the container, ports on 127.0.0.1 only. lives on the server as `/opt/custock/compose.yml` |
| `ship.sh` | build and restart by hand from your machine |

Once on the server: `/opt/custock/.env` from `env.example` (secrets, `CUSTOCK_PUBLIC_WEB_URL` as
`https://custock.example.com`, `CUSTOCK_API_URL` as `https://custock.example.com/api`,
`CUSTOCK_CORS` as the same origin, `CUSTOCK_TRUSTED_PROXY=1`), a DNS record (A, and AAAA if the
server has IPv6), a certificate (`certbot certonly --apache -d custock.example.com`), then the
virtual host. For Apache, the api first:

```
<VirtualHost *:443>
    ServerName custock.example.com
    SSLCertificateFile /etc/letsencrypt/live/custock.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/custock.example.com/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    Header always set Strict-Transport-Security "max-age=31536000"

    ProxyPass        /api/ http://127.0.0.1:8790/
    ProxyPassReverse /api/ http://127.0.0.1:8790/
    ProxyPass        /     http://127.0.0.1:3090/
    ProxyPassReverse /     http://127.0.0.1:3090/
</VirtualHost>
```

plus a `:80` virtual host that redirects to https. The bucket's CORS rule must allow the same
origin (see [apps/api](../apps/api/README.md)).

Then every update, from the repo on your machine:

```
CUSTOCK_SSH=root@your-server CUSTOCK_SSH_KEY=~/.ssh/your-key sh deploy/ship.sh
```

Only committed code is shipped. The data lives in the `custock_data` volume and survives rebuilds.
Migrations run when the api starts and only go forward. The first super admin and the first business
are created with the api's command line inside the container (see [apps/api](../apps/api/README.md)).

Serving under a path of a shared domain still works (`CUSTOCK_BASE_PATH=/custock` for `ship.sh`),
but only for testing, for the reason above.

The rest of this file is the bigger setup with the api and web as separate services and
litestream next to them.

## first install

1. A server with Docker and the compose plugin, a user that is not root, the firewall open for 22,
   80 and 443 only.
2. A reverse proxy (Caddy is the simplest) in front: `custock.example.com` to `127.0.0.1:3000`,
   `api.custock.example.com` to `127.0.0.1:8787`. Caddy gets the certificates by itself.
3. The web needs `output: "standalone"` in `apps/web/next.config.ts` for its Dockerfile.
4. On the server:

   ```
   git clone <repo> /opt/custock && cd /opt/custock/deploy
   cp env.example .env && nano .env        # secrets, urls, bucket
   docker compose build
   docker compose run --rm litestream restore -if-replica-exists /data/custock.db
   docker compose up -d
   docker compose logs -f api              # "custock api on http://localhost:8787 (production ...)"
   curl -s https://api.custock.example.com/health
   ```

   The restore line does nothing on the very first install (no replica yet) and brings the database
   back on a new server.

## updating

```
ssh server
cd /opt/custock && git pull
cd deploy && docker compose build && docker compose up -d
```

Migrations run when the api starts. They only go forward. Take a snapshot first if the update has
a new migration (see below).

## backups

Two layers.

- **litestream** streams every change to the bucket within seconds and keeps 30 days.
- **a nightly snapshot** with `VACUUM INTO`, kept on the server for 30 days. Add to the crontab of
  the server user:

  ```
  15 3 * * *  docker compose -f /opt/custock/deploy/docker-compose.yml exec -T api \
    node scripts/db-snapshot.mjs --db /data/custock.db --out /data/snapshots --keep 30
  ```

  Without docker:
  `node /opt/custock/scripts/db-snapshot.mjs --db /var/lib/custock/custock.db --out /var/lib/custock/snapshots`.

## restoring

From litestream, to the newest point or to a moment in time:

```
docker compose stop api
docker compose run --rm litestream restore -o /data/restored.db /data/custock.db
#   or with -timestamp 2026-11-17T09:00:00Z for a point in time
docker compose run --rm --entrypoint sh litestream -c "mv /data/custock.db /data/custock.db.bad; mv /data/restored.db /data/custock.db; rm -f /data/custock.db-wal /data/custock.db-shm"
docker compose up -d api
```

From a snapshot: stop the api, copy the snapshot over `custock.db`, remove the `-wal` and `-shm`
files, start the api. The api rebuilds the search index when it starts, because row ids can move
in a snapshot.

## the monthly restore test

Once a month, restore the newest backup somewhere else and check it:

```
docker compose run --rm litestream restore -o /data/restore-test.db /data/custock.db
docker compose exec api node scripts/db-restore-check.mjs --file /data/restore-test.db
```

It checks integrity, foreign keys, that cached stock equals the ledger, that the search index
rebuilds, and prints the row counts. Write the date and the counts in the ops notes. A test that
was never run is not a backup.

## without docker

`custock-api.service` runs the api with node 22 from `/opt/custock` as a `custock` user, with the
database in `/var/lib/custock`. Litestream has its own package with a systemd unit: point its
config at `/var/lib/custock/custock.db`. The web can run the same way with
`node apps/web/server.js` from a standalone build.

## sending for real

Not before the domain has SPF, DKIM and DMARC, and not before the team says so. Then:
`CUSTOCK_TRANSPORT=live`, the service account file, the SMTP url, the sender address, and
`CUSTOCK_ALLOW_SENDING=yes`. The api refuses to start in live mode if any of them is missing.
