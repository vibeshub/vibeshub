"""One-off DB connectivity check. Run via `python /app/app/check_db.py` from
inside the container — typically by overriding the Container App's command/args
(see deploy/azure/README.md for the technique). Prints psycopg/libpq/openssl
versions, resolves the DB host, and attempts a direct psycopg.connect() with
the same DSN the app uses. Sleeps 10 min on completion so logs survive
Container Apps replica churn."""
import os
import socket
import ssl
import time

import psycopg


def main() -> None:
    print("== diag start ==", flush=True)
    print("psycopg:", psycopg.__version__, flush=True)
    print("libpq:  ", psycopg.pq.version(), flush=True)
    print("openssl:", ssl.OPENSSL_VERSION, flush=True)

    url = os.environ.get("VIBESHUB_DATABASE_URL", "")
    print("url-len:", len(url), flush=True)
    if not url:
        print("ABORT: VIBESHUB_DATABASE_URL not set in container env", flush=True)
        return

    dsn = url.replace("+psycopg", "")
    host = dsn.split("@", 1)[1].split(":", 1)[0]
    try:
        ip = socket.gethostbyname(host)
        print(f"dns: {host} -> {ip}", flush=True)
    except Exception as e:
        print("dns FAIL:", repr(e), flush=True)

    try:
        c = psycopg.connect(dsn, connect_timeout=15)
        cur = c.cursor()
        cur.execute("select current_user, inet_server_addr()::text, version()")
        print("CONNECT OK:", cur.fetchone(), flush=True)
        c.close()
    except Exception as e:
        print("CONNECT FAIL:", type(e).__name__, repr(e)[:800], flush=True)

    print("== diag done — sleeping ==", flush=True)
    time.sleep(600)


if __name__ == "__main__":
    main()
