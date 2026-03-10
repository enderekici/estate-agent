# Deployment

This app can be deployed to a VPS using Docker in the same style as the `trader212` project.

## Files

- `Dockerfile`
- `docker-compose.prod.yml`
- `deploy.config.example`
- `deploy.sh`
- `manage-vps.sh`

## Quick start

1. Copy `deploy.config.example` to `deploy.config`
2. Fill in:
   - `SERVER`
   - `SSH_KEY`
   - `DEPLOY_DIR`
   - optionally `GHCR_USERNAME` / `GHCR_TOKEN`
3. Ensure the VPS has an `.env` file with the app secrets and overrides you want
4. Run:

```bash
chmod +x deploy.sh manage-vps.sh
./deploy.sh
```

## Operations

```bash
./manage-vps.sh status
./manage-vps.sh logs
./manage-vps.sh restart
./manage-vps.sh backup
```

## Notes

- Production data lives in `./data` on the VPS and is mounted into `/app/data`
- The container exposes port `3000`
- Health checks use `GET /api/config`
- This deployment flow assumes a container image is available at `ghcr.io/enderekici/estate-agent:main`
