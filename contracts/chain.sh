#!/usr/bin/env bash
# Start a fresh anvil and deploy PerpDEX onto it, or stop it.
#
#   ./chain.sh up      kill any anvil on the port, start a new one, deploy, write deployments/31337.json
#   ./chain.sh down    stop it
#   ./chain.sh status  chain id, block number, exchange address
#
# Fresh every time on purpose: scenarios snapshot/revert to THEIR start, so
# the deployment underneath must be clean or every scenario inherits history.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
# anvil's first account. Public; only ever used on chain 31337.
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
LOG="${ANVIL_LOG:-/tmp/anvil-${PORT}.log}"

stop() {
  pkill -f "anvil --code-size-limit 262144 --port ${PORT}" 2>/dev/null || true
  sleep 0.5
}

case "${1:-up}" in
  up)
    stop
    setsid nohup anvil --code-size-limit 262144 --port "${PORT}" --silent > "${LOG}" 2>&1 < /dev/null &
    disown || true
    for i in $(seq 1 50); do
      if cast chain-id --rpc-url "${RPC}" >/dev/null 2>&1; then break; fi
      sleep 0.2
    done
    # deployments/ is gitignored, so a fresh clone has no such directory and
    # forge's vm.writeFile cannot create the parent -- make it first.
    mkdir -p deployments
    forge script script/Deploy.s.sol:Deploy --rpc-url "${RPC}" --broadcast --disable-code-size-limit --private-key "${KEY}" >/dev/null
    # the indexer store belongs to the previous chain instance (it would refuse to start anyway)
    rm -rf ../services/mini-api/data
    echo "anvil ${RPC} chain $(cast chain-id --rpc-url "${RPC}")  exchange $(grep -o '"exchange": "0x[0-9a-fA-F]*"' deployments/31337.json | grep -o '0x[0-9a-fA-F]*')"
    ;;
  down)
    stop
    echo "anvil stopped"
    ;;
  status)
    echo "chain $(cast chain-id --rpc-url "${RPC}")  block $(cast block-number --rpc-url "${RPC}")  exchange $(grep -o '"exchange": "0x[0-9a-fA-F]*"' deployments/31337.json | grep -o '0x[0-9a-fA-F]*')"
    ;;
  *)
    echo "usage: $0 up|down|status" >&2
    exit 2
    ;;
esac
