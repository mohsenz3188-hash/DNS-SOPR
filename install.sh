#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  DNS Panel — one-line installer (X-UI style)
#  Repository: https://github.com/mohsenz3188-hash/DNS-SOPR
#
#  Usage on a Linux server (Ubuntu / Debian / RHEL family):
#    curl -sSL https://raw.githubusercontent.com/mohsenz3188-hash/DNS-SOPR/main/install.sh | bash
#
#  Optional environment variables:
#    REPO_URL   Git URL of this repository
#               (default: https://github.com/mohsenz3188-hash/DNS-SOPR.git)
#    PORT       Panel port (default: 2053)
#    BRANCH     Git branch to install (default: main)
#
#  The script is idempotent: re-running it updates the code in
#  /opt/dns-panel and restarts the service. Stored data in
#  /opt/dns-panel/data is never deleted.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mohsenz3188-hash/DNS-SOPR.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-2053}"
INSTALL_DIR="/opt/dns-panel"
SERVICE_NAME="dns-panel"
SERVICE_USER="dns-panel"

log()  { printf '\033[1;32m[dns-panel]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dns-panel]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[dns-panel]\033[0m %s\n' "$*" >&2; exit 1; }

# ── root check ────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    warn "Re-running with sudo…"
    exec sudo -E bash "$0" "$@"
  fi
  die "Please run as root (or with sudo)."
fi

# ── package manager helpers ──────────────────────────────────
PM=""
if command -v apt-get >/dev/null 2>&1; then PM="apt";
elif command -v dnf >/dev/null 2>&1; then PM="dnf";
elif command -v yum >/dev/null 2>&1; then PM="yum";
fi

pkg_install() {
  case "$PM" in
    apt) apt-get update -y && apt-get install -y "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
    *) die "Unsupported distribution: no apt/dnf/yum found." ;;
  esac
}

# ── base tools ────────────────────────────────────────────────
for tool in curl git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "Installing $tool…"
    pkg_install "$tool"
  fi
done

# ── Node.js >= 18 ─────────────────────────────────────────────
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ]
}
if ! node_ok; then
  log "Installing Node.js 20 LTS…"
  case "$PM" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      $PM install -y nodejs
      ;;
  esac
fi
node_ok || die "Node.js >= 18 is required but could not be installed."
log "Node.js $(node -v) ready."

# ── fetch sources ─────────────────────────────────────────────
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

TMP_CLONE=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/standalone/server.js" ]; then
  SRC_DIR="$SCRIPT_DIR"
  log "Installing from local checkout: $SRC_DIR"
else
  TMP_CLONE="$(mktemp -d)"
  log "Cloning $REPO_URL (branch $BRANCH)…"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_CLONE/repo"
  SRC_DIR="$TMP_CLONE/repo"
fi
[ -f "$SRC_DIR/standalone/server.js" ] || die "standalone/server.js not found in sources."

# ── system user ───────────────────────────────────────────────
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creating system user '$SERVICE_USER'…"
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
    || useradd --system --home-dir "$INSTALL_DIR" --shell /sbin/nologin "$SERVICE_USER"
fi

# ── install files (data directory is preserved) ──────────────
log "Installing panel files to $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR/standalone" "$INSTALL_DIR/data"
cp -f "$SRC_DIR/standalone/server.js"    "$INSTALL_DIR/standalone/server.js"
cp -f "$SRC_DIR/standalone/package.json" "$INSTALL_DIR/standalone/package.json"
[ -f "$SRC_DIR/install.sh" ]        && cp -f "$SRC_DIR/install.sh"        "$INSTALL_DIR/install.sh"        || true
[ -f "$SRC_DIR/README.md" ]         && cp -f "$SRC_DIR/README.md"         "$INSTALL_DIR/README.md"         || true
[ -f "$SRC_DIR/dns-panel.service" ] && cp -f "$SRC_DIR/dns-panel.service" "$INSTALL_DIR/dns-panel.service" || true
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/standalone/server.js" || true
[ -n "$TMP_CLONE" ] && rm -rf "$TMP_CLONE" || true

# ── systemd service ───────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
  log "Installing systemd service…"
  if [ -f "$INSTALL_DIR/dns-panel.service" ]; then
    sed "s/^Environment=PORT=.*/Environment=PORT=$PORT/" \
      "$INSTALL_DIR/dns-panel.service" > "/etc/systemd/system/$SERVICE_NAME.service"
  else
    cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=DNS Panel
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) $INSTALL_DIR/standalone/server.js
Restart=always
RestartSec=3
Environment=PORT=$PORT
Environment=DATA_DIR=$INSTALL_DIR/data

[Install]
WantedBy=multi-user.target
EOF
  fi
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  sleep 1
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log "Service '$SERVICE_NAME' is running."
  else
    warn "Service did not start — check: journalctl -u $SERVICE_NAME -e"
  fi
else
  warn "systemd not found — start manually: PORT=$PORT DATA_DIR=$INSTALL_DIR/data node $INSTALL_DIR/standalone/server.js"
fi

# ── firewall hint ─────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
  log "Opened port $PORT in ufw."
fi

IP="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo 'YOUR-SERVER-IP')"
echo
log "✅ DNS Panel installed successfully!"
log "   Panel URL : http://$IP:$PORT"
log "   Status    : systemctl status $SERVICE_NAME"
log "   Logs      : journalctl -u $SERVICE_NAME -f"
log "   Data file : $INSTALL_DIR/data/db.json"
