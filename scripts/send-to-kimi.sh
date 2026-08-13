#!/usr/bin/env bash
# Envía un mensaje al pane de Kimi dentro de Herdr.
# Uso: ./send-to-kimi.sh "mensaje"

MESSAGE="${1:-}"
if [ -z "$MESSAGE" ]; then
  echo "Uso: $0 \"mensaje\""
  exit 1
fi

WORKSPACE="${HERDR_WORKSPACE:-main}"
PANE="${HERDR_PANE_KIMI:-kimi}"

# Intentar varios comandos posibles de Herdr
for cmd in \
  "herdr send --workspace \"$WORKSPACE\" --pane \"$PANE\" \"$MESSAGE\"" \
  "herdr send --pane \"$PANE\" \"$MESSAGE\"" \
  "herdr send \"$PANE\" \"$MESSAGE\""; do
  if eval "$cmd" 2>/dev/null; then
    echo "Mensaje enviado a Kimi."
    exit 0
  fi
done

echo "Error: no se pudo enviar el mensaje. Verificá 'herdr --help'."
exit 1
