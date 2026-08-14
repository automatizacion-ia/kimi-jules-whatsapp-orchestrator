#!/bin/bash
set -e

# Carga variables de entorno
if [ -f /app/.env ]; then
  set -a
  # shellcheck source=/dev/null
  source /app/.env
  set +a
fi

# Inicia herdr en background si no está corriendo
if ! pgrep -f "herdr" > /dev/null; then
  echo "Iniciando herdr..."
  export PATH="/root/.local/bin:$PATH"
  herdr server &
fi

# Espera a que herdr esté listo
sleep 5

# Crea workspace y pane de Kimi si no existen
export PATH="/root/.kimi-code/bin:/root/.local/bin:$PATH"
if ! herdr pane list 2>/dev/null | grep -q "w1:p1"; then
  echo "Creando workspace y pane de Kimi..."
  herdr workspace create --label w1 2>/dev/null || true
  sleep 2
  # Inicia bash en el pane y luego envia el comando kimi
  herdr pane run w1:p1 bash 2>/dev/null || true
  sleep 2
  herdr pane send-text w1:p1 kimi 2>/dev/null || true
  sleep 1
  herdr pane send-keys w1:p1 Enter 2>/dev/null || true
fi

# Ejecuta el comando recibido
exec "$@"
