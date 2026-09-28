#!/usr/bin/env bash
# Stops a test-owned portal server if the test that started it dies without cleaning up.
#
# usage: kill-when-orphaned.sh <owner-pid> <target-pid>
#
# A test's own cleanup (a bash EXIT trap, a node 'exit' handler) never runs when the test is
# SIGKILLed — the usual way an agent harness or CI enforces a timeout. The server it started then
# lives on with PPID 1, holding a port, indefinitely. This watchdog runs as a separate process, so it
# survives the owner: once the owner is gone it stops the target, and it exits on its own as soon as
# the target stops first (the normal path, where the test cleaned up after itself).
set -u
owner="$1"
target="$2"

while kill -0 "${owner}" 2>/dev/null && kill -0 "${target}" 2>/dev/null; do
  sleep 1
done

kill -0 "${target}" 2>/dev/null || exit 0
# Guard against PID reuse: only stop a process that is still a roborepo portal server.
case "$(ps -o command= -p "${target}" 2>/dev/null)" in
  *main.mjs\ web*) ;;
  *) exit 0 ;;
esac
kill -TERM "${target}" 2>/dev/null || exit 0
for _ in $(seq 1 50); do
  kill -0 "${target}" 2>/dev/null || exit 0
  sleep 0.1
done
kill -KILL "${target}" 2>/dev/null || true
