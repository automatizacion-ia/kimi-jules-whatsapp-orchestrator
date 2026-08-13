#!/usr/bin/env bash
# Crea un issue en GitHub para que Jules de Google lo procese.
# Uso: ./create-github-issue.sh "título" "cuerpo" [repo]

TITLE="${1:-}"
BODY="${2:-}"
REPO="${3:-$GITHUB_DEFAULT_REPO}"
ORG="${GITHUB_ORG:-automatizacion-ia}"

if [ -z "$TITLE" ] || [ -z "$REPO" ]; then
  echo "Uso: $0 \"título del issue\" \"cuerpo del issue\" [nombre-repo]"
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN no está definido."
  exit 1
fi

GH_TOKEN="$GITHUB_TOKEN" gh issue create \
  --repo "$ORG/$REPO" \
  --title "$TITLE" \
  --body "$BODY"
