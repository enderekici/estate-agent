#!/bin/bash
set -euo pipefail

if [ -f "deploy.config" ]; then
  # shellcheck disable=SC1091
  source deploy.config
else
  echo "Error: deploy.config not found"
  echo "Copy deploy.config.example to deploy.config first."
  exit 1
fi

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

show_help() {
  echo "Estate Agent VPS Management"
  echo ""
  echo "Usage: ./manage-vps.sh [command]"
  echo ""
  echo "Commands:"
  echo "  logs      - View live container logs"
  echo "  status    - Check container status and health"
  echo "  restart   - Restart service"
  echo "  stop      - Stop service"
  echo "  start     - Start service"
  echo "  ssh       - SSH into the server"
  echo "  update    - Run deploy.sh"
  echo "  backup    - Download the current SQLite DB"
  echo "  restore   - Restore SQLite DB from a local backup file"
}

run_logs() {
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml logs -f"
}

run_status() {
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml ps"
  echo ""
  ssh -i "$SSH_KEY" "$SERVER" "node -e \"fetch('http://localhost:3000/api/config').then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2))).catch(e=>{console.error(e.message);process.exit(1)})\""
}

run_restart() {
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml restart"
}

run_stop() {
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml stop"
}

run_start() {
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml up -d"
}

run_ssh() {
  ssh -i "$SSH_KEY" "$SERVER"
}

run_update() {
  ./deploy.sh
}

run_backup() {
  mkdir -p backups
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="backups/estate-agent_${timestamp}.db"
  scp -i "$SSH_KEY" "$SERVER:$DEPLOY_DIR/data/listings.db" "$backup_file"
  echo -e "${GREEN}Backup saved to $backup_file${NC}"
}

run_restore() {
  if [ -z "${1:-}" ]; then
    echo -e "${RED}Please provide a backup file path${NC}"
    exit 1
  fi
  scp -i "$SSH_KEY" "$1" "$SERVER:$DEPLOY_DIR/data/listings.db"
  run_restart
}

case "${1:-help}" in
  logs) run_logs ;;
  status) run_status ;;
  restart) run_restart ;;
  stop) run_stop ;;
  start) run_start ;;
  ssh) run_ssh ;;
  update) run_update ;;
  backup) run_backup ;;
  restore) run_restore "${2:-}" ;;
  *) show_help ;;
esac
