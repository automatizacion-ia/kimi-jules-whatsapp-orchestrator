#!/usr/bin/env bash
set -e

# =============================================================================
# Setup del orquestador Kimi + Jules + WhatsApp en VPS Ubuntu
# =============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "Por favor ejecutá este script con sudo."
  exit 1
fi

echo "=== Actualizando sistema ==="
apt update && apt upgrade -y

echo "=== Instalando dependencias base ==="
apt install -y \
  curl \
  wget \
  git \
  build-essential \
  sqlite3 \
  libssl-dev \
  pkg-config \
  ca-certificates \
  gnupg \
  lsb-release \
  software-properties-common \
  htop \
  ncdu \
  unzip

echo "=== Instalando dependencias de Chrome/Puppeteer ==="
apt install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libxss1 \
  libgtk-3-0 \
  libgbm-dev \
  libasound2 \
  fonts-liberation \
  libappindicator3-1 \
  xdg-utils

echo "=== Instalando Google Chrome ==="
if ! command -v google-chrome-stable &> /dev/null; then
  wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb
  apt install -y /tmp/chrome.deb || apt-get install -fy
  rm -f /tmp/chrome.deb
fi

# symlink para que puppeteer y whatsapp-web.js lo encuentren
if [ ! -f /usr/bin/chromium-browser ]; then
  ln -s "$(command -v google-chrome-stable)" /usr/bin/chromium-browser
fi

echo "=== Instalando Node.js 20 ==="
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

echo "=== Configurando swap de 4 GB ==="
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap activado."
else
  echo "Swap ya existe."
fi

echo "=== Instalando Herdr ==="
if ! command -v herdr &> /dev/null; then
  curl -fsSL https://herdr.dev/install.sh | sh
fi

echo "=== Creando usuario herdr ==="
if ! id -u herdr &> /dev/null; then
  useradd -m -s /bin/bash herdr
fi
usermod -aG sudo herdr

echo "=== Instalando GitHub CLI ==="
if ! command -v gh &> /dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  apt update
  apt install gh -y
fi

echo "=== Configurando servicio systemd de Herdr ==="
cp "$REPO_DIR/systemd/herdr.service" /etc/systemd/system/herdr.service
mkdir -p /run/herdr
chown herdr:herdr /run/herdr
systemctl daemon-reload
systemctl enable herdr
systemctl start herdr || true

echo "=== Instalando dependencias del webhook ==="
cd "$REPO_DIR/webhook-receiver"
# Usar Chrome del sistema, no descargar Chromium de puppeteer
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install

echo "=== Configurando servicio systemd del webhook-receiver ==="
cp "$REPO_DIR/systemd/webhook-receiver.service" /etc/systemd/system/webhook-receiver.service
systemctl daemon-reload
systemctl enable webhook-receiver || true

echo "=== Configuración inicial completada ==="
echo ""
echo "Próximos pasos:"
echo "1. Copiar .env.example a .env y completar las variables."
echo "2. Iniciar sesión en Herdr: su - herdr -c 'herdr'"
echo "3. Crear un pane llamado 'kimi' y correr: kimi"
echo "4. Iniciar webhook: sudo systemctl start webhook-receiver"
echo "5. Escanear el QR de WhatsApp la primera vez (se guarda en webhook-receiver/qr.png)."
echo ""
echo "Recomendación: revisar los logs con: sudo journalctl -u webhook-receiver -f"
