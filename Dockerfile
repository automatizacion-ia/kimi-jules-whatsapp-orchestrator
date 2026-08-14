FROM node:20-bullseye

ENV DEBIAN_FRONTEND=noninteractive

# Instala dependencias de Chrome/Puppeteer
RUN apt-get update && apt-get install -y \
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
    libnss3 \
    libatk-bridge2.0-0 \
    libxss1 \
    libgtk-3-0 \
    libgbm-dev \
    libasound2 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Instala Google Chrome
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb || apt-get install -fy \
    && rm -f /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# symlink para que puppeteer y whatsapp-web.js lo encuentren
RUN ln -sf "$(command -v google-chrome-stable)" /usr/bin/chromium-browser

# Instala Herdr
RUN curl -fsSL https://herdr.dev/install.sh | sh

# Crea usuario herdr
RUN useradd -m -s /bin/bash herdr \
    && usermod -aG sudo herdr

# Crea directorio de trabajo
WORKDIR /app

# Copia el repo
COPY . /app

# Instala dependencias del webhook-receiver
WORKDIR /app/webhook-receiver
RUN npm install

# Vuelve al directorio principal
WORKDIR /app

# Expone el puerto del webhook
EXPOSE 3000

# Script de entrada
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "webhook-receiver/index.js"]
