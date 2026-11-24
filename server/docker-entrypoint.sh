#!/bin/sh
# Fix the ownership of the data volume, then drop to the printninja user.
set -e
chown printninja:printninja /data
exec setpriv --reuid=printninja --regid=printninja --init-groups /app/pn-server "$@"
