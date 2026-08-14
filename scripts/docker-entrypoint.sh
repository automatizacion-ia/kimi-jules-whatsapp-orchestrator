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

# Ejecuta el comando recibido
exec "$@"
