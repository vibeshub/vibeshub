#!/usr/bin/env bash
#
# Redeploy vibeshub to Azure Container Apps.
#
# Assumes the resource group, ACR, Postgres Flexible Server, Storage account
# + blob container, managed identity, and Container Apps environment already
# exist (per ./README.md). This script only:
#
#   1. Builds the SPA so frontend_dist/ is fresh
#   2. Cloud-builds + pushes the backend image via `az acr build`
#   3. Creates the Container App if missing, otherwise updates it
#   4. Applies env vars from ./.env using --set-env-vars (merges, never wipes)
#
# Usage: ./deploy/azure/deploy.sh
#
set -euo pipefail

# ---- edit these for your environment --------------------------------------
RG="vibeshub"
APP="vibeshub"
APP_ENV="vibeshub-env"        # Container Apps environment name
MI="vibeshub-mi"              # User-assigned managed identity name
ACR="vibeshub"                # TODO: set your ACR name (no .azurecr.io suffix)
IMAGE_TAG="latest"
# --------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
BUILD_CONTEXT="$REPO_ROOT/webapp/backend"

# ---- preflight ------------------------------------------------------------
if [ -z "$ACR" ]; then
  echo "ERROR: set ACR= at the top of $0 to your registry name." >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "       Copy $SCRIPT_DIR/.env.example to $SCRIPT_DIR/.env and fill in the values." >&2
  exit 1
fi
command -v az  >/dev/null || { echo "ERROR: az CLI not installed."  >&2; exit 1; }
command -v npm >/dev/null || { echo "ERROR: npm not installed."     >&2; exit 1; }

# ---- parse .env into KEY=VALUE pairs we'll forward to the container -------
# Forward VIBESHUB_* and AZURE_CLIENT_ID only. Skip blanks and comments.
ENV_PAIRS=()
while IFS= read -r line || [ -n "$line" ]; do
  # strip leading whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  case "$line" in
    ''|\#*) continue ;;
  esac
  # require KEY=VALUE shape
  case "$line" in
    *=*) ;;
    *) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    VIBESHUB_*|AZURE_CLIENT_ID) ;;
    *) continue ;;
  esac
  # strip a single matching pair of surrounding quotes
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  ENV_PAIRS+=("$key=$value")
done < "$ENV_FILE"

# ---- validate required keys are present ----------------------------------
REQUIRED="VIBESHUB_DATABASE_URL VIBESHUB_AZURE_BLOB_CONTAINER VIBESHUB_AZURE_STORAGE_ACCOUNT_URL AZURE_CLIENT_ID VIBESHUB_PUBLIC_BASE_URL"
missing=""
for k in $REQUIRED; do
  found=0
  for pair in "${ENV_PAIRS[@]}"; do
    case "$pair" in
      "$k="*) found=1; break ;;
    esac
  done
  [ "$found" = "1" ] || missing="$missing $k"
done
if [ -n "$missing" ]; then
  echo "ERROR: .env is missing required keys:$missing" >&2
  exit 1
fi

echo "Env keys to apply to Container App (values redacted):"
for pair in "${ENV_PAIRS[@]}"; do
  echo "  - ${pair%%=*}"
done

# ---- build the frontend (Dockerfile copies frontend_dist) -----------------
echo
echo "==> Building frontend..."
(cd "$REPO_ROOT/webapp/frontend" && npm install && npm run build:deploy)

# ---- cloud build + push the backend image -------------------------------
echo
echo "==> Building image via 'az acr build' (cloud-side, amd64)..."
az acr build \
  --registry "$ACR" \
  --image "vibeshub:${IMAGE_TAG}" \
  --file "$DOCKERFILE" \
  "$BUILD_CONTEXT"

IMAGE="${ACR}.azurecr.io/vibeshub:${IMAGE_TAG}"

# ---- create-or-update the Container App ---------------------------------
MI_ID="$(az identity show -g "$RG" -n "$MI" --query id -o tsv)"

if az containerapp show -n "$APP" -g "$RG" >/dev/null 2>&1; then
  echo
  echo "==> Container App '$APP' exists — updating image and env..."
  az containerapp update \
    -n "$APP" -g "$RG" \
    --image "$IMAGE" \
    --set-env-vars "${ENV_PAIRS[@]}"
  # Re-assert the user-assigned identity. `containerapp update` does not
  # touch identity, so if the MI was detached out-of-band (or the app
  # was created without it) blob writes will hang on IMDS until they
  # time out. Running `identity assign` is idempotent.
  echo "==> Ensuring user-assigned identity '$MI' is attached..."
  az containerapp identity assign \
    -n "$APP" -g "$RG" \
    --user-assigned "$MI_ID" >/dev/null
else
  echo
  echo "==> Container App '$APP' not found — creating..."
  az containerapp create \
    -n "$APP" -g "$RG" \
    --environment "$APP_ENV" \
    --image "$IMAGE" \
    --registry-server "${ACR}.azurecr.io" \
    --registry-identity "$MI_ID" \
    --user-assigned "$MI_ID" \
    --ingress external --target-port 8000 \
    --min-replicas 1 --max-replicas 3 \
    --env-vars "${ENV_PAIRS[@]}"
fi

# ---- report -------------------------------------------------------------
FQDN="$(az containerapp show -n "$APP" -g "$RG" \
        --query properties.configuration.ingress.fqdn -o tsv)"
echo
echo "==> Deployed."
echo "    URL: https://$FQDN"

# Surface a likely-misconfigured PUBLIC_BASE_URL so trace_url responses are correct.
# Accept either the default FQDN or any bound custom hostname.
configured=""
for pair in "${ENV_PAIRS[@]}"; do
  case "$pair" in
    VIBESHUB_PUBLIC_BASE_URL=*) configured="${pair#VIBESHUB_PUBLIC_BASE_URL=}" ;;
  esac
done

accepted=("https://$FQDN")
while IFS= read -r host; do
  [ -n "$host" ] && accepted+=("https://$host")
done < <(az containerapp hostname list -n "$APP" -g "$RG" --query "[].name" -o tsv 2>/dev/null || true)

matched=0
for a in "${accepted[@]}"; do
  if [ "$configured" = "$a" ]; then matched=1; break; fi
done

if [ -n "$configured" ] && [ "$matched" -eq 0 ]; then
  echo
  echo "NOTE: VIBESHUB_PUBLIC_BASE_URL in .env is '$configured'"
  echo "      but it doesn't match the default FQDN or any bound custom hostname."
  echo "      Accepted origins for this Container App:"
  for a in "${accepted[@]}"; do echo "        $a"; done
  echo "      Update .env and re-run so trace_url responses use the right origin."
fi
