#!/bin/bash
set -euo pipefail

if [ -f "deploy.config" ]; then
  # shellcheck disable=SC1091
  source deploy.config
else
  echo "Error: deploy.config not found"
  echo "Copy deploy.config.example to deploy.config and fill in:"
  echo "  SERVER=ubuntu@your-vps-ip-address"
  echo "  SSH_KEY=\$HOME/path/to/your/ssh-key.pem"
  echo "  DEPLOY_DIR=/home/ubuntu/estate-agent"
  echo "  GHCR_TOKEN=your_github_token (optional, for private repos)"
  exit 1
fi

echo "Deploying Estate Agent to VPS..."

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Creating deployment directory on server...${NC}"
ssh -i "$SSH_KEY" "$SERVER" "mkdir -p $DEPLOY_DIR/data"

echo -e "${BLUE}Copying docker-compose.prod.yml...${NC}"
scp -i "$SSH_KEY" docker-compose.prod.yml "$SERVER:$DEPLOY_DIR/"

if [ -f .env ]; then
  echo -e "${BLUE}Copying .env file...${NC}"
  scp -i "$SSH_KEY" .env "$SERVER:$DEPLOY_DIR/.env"
else
  echo -e "${YELLOW}WARNING: no local .env file found; ensure one exists on the server.${NC}"
fi

ssh -i "$SSH_KEY" "$SERVER" <<ENDSSH
set -e
cd "$DEPLOY_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  sudo usermod -aG docker ubuntu
  rm get-docker.sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin not found"
  exit 1
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "Logging in to GHCR..."
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u enderekici --password-stdin
fi

echo "Stopping existing containers..."
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

echo "Pulling latest image..."
docker compose -f docker-compose.prod.yml pull

echo "Starting service..."
docker compose -f docker-compose.prod.yml up -d

echo "Waiting for service to become healthy..."
sleep 15

docker compose -f docker-compose.prod.yml ps
ENDSSH

echo -e "${GREEN}Deployment complete${NC}"
