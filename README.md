# Kimi + Jules + WhatsApp Orchestrator

Orquestador que corre en una VM de 4 GB con:

- **Herdr**: runtime persistente para agentes CLI.
- **Kimi Code CLI**: recibe mensajes de WhatsApp, planifica y responde.
- **Jules de Google**: ejecuta cambios de código en repositorios de GitHub.
- **whatsapp-web.js**: recibe y envía mensajes de WhatsApp Web.

> **Nota sobre open-wa:** originalmente se evaluó `@open-wa/wa-automate`, pero la última versión estable (4.76.0) falla contra WhatsApp Web actual porque ya no expone `window.Debug`. Por eso el proyecto usa `whatsapp-web.js`, que es open source y se mantiene actualizado.

## Arquitectura

```text
Usuario de WhatsApp
        ↓
    whatsapp-web.js (WhatsApp Web)
        ↓
   webhook-receiver (Node.js)
        ↓
    Kimi dentro de Herdr
        ↓
   ├─ Respuesta simple → WhatsApp
   └─ Necesita código → GitHub issue/PR → Jules de Google
```

## Requisitos

- VPS con Ubuntu 22.04/24.04 (o similar).
- 4 GB de RAM mínimo (recomendado swap de 4 GB).
- Acceso SSH.
- Cuenta de GitHub con acceso a la organización `automatizacion-ia`.
- Jules de Google habilitado en los repos donde va a trabajar.
- Número de WhatsApp para escanear con whatsapp-web.js (recomendado secundario).

## Advertencias

- whatsapp-web.js **no es oficial**. WhatsApp puede banear el número.
- 4 GB es justo: no corras modelos locales ni Dokploy en la misma VM.
- Considerá usar WhatsApp Cloud API (oficial) en producción.

## Instalación rápida

```bash
# 1. Clonar el repo en la VM
git clone https://github.com/automatizacion-ia/kimi-jules-whatsapp-orchestrator.git
cd kimi-jules-whatsapp-orchestrator

# 2. Copiar y completar variables de entorno
cp .env.example .env
nano .env

# 3. Ejecutar setup
chmod +x setup.sh
sudo ./setup.sh
```

## Configuración manual paso a paso

### 1. Instalar dependencias base

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential sqlite3 libssl-dev pkg-config
```

### 2. Instalar Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Instalar Herdr

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

Copiar `systemd/herdr.service` a `/etc/systemd/system/` y arrancar:

```bash
sudo cp systemd/herdr.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable herdr
sudo systemctl start herdr
```

### 4. Instalar Kimi Code CLI

Seguir las instrucciones oficiales de Kimi Code CLI. Dentro de Herdr abrir un pane y correr:

```bash
herdr
# Ctrl+B C para nuevo pane
kimi
```

### 5. Configurar webhook-receiver

```bash
cd webhook-receiver
npm install
cp ../.env .env
npm start
```

Recomendado correr con systemd en producción:

```bash
sudo cp systemd/webhook-receiver.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable webhook-receiver
sudo systemctl start webhook-receiver
```

### 6. Configurar whatsapp-web.js

whatsapp-web.js se levanta desde el mismo `webhook-receiver`. La primera vez escaneá el QR que se guarda en `webhook-receiver/qr.png`. La sesión se guarda en `.wwebjs_auth/`.

### 7. Configurar GitHub

- Crear un Personal Access Token con permisos `repo`.
- Agregarlo en `.env` como `GITHUB_TOKEN`.
- Habilitar Jules de Google en los repositorios objetivo.

## Flujo de un mensaje

1. Alguien escribe por WhatsApp.
2. whatsapp-web.js recibe el mensaje y lo pasa al webhook-receiver.
3. El webhook le pasa el mensaje a Kimi via Herdr.
4. Kimi decide:
   - Responde directo → se envía por WhatsApp.
   - Necesita código → crea un issue/PR en GitHub con `gh`.
5. Jules de Google detecta el issue/PR y ejecuta el cambio.
6. Una GitHub Action o webhook puede notificar a Kimi para responder al usuario.

## Variables de entorno

Ver `.env.example`.

## Troubleshooting

### whatsapp-web.js consume mucha RAM

Verificar flags de Chromium en `webhook-receiver/index.js`. Si sigue alto, considerar swap o WhatsApp Cloud API.

### No aparece el QR

Revisar logs:

```bash
sudo journalctl -u webhook-receiver -f
```

Borrar la sesión y reiniciar:

```bash
sudo systemctl stop webhook-receiver
sudo rm -rf /opt/kimi-jules-whatsapp-orchestrator/webhook-receiver/.wwebjs_auth
sudo systemctl start webhook-receiver
```

### Herdr no arranca

Revisar permisos del socket:

```bash
sudo systemctl status herdr
ls -la /run/herdr/
```

### Kimi no recibe mensajes

Verificar que el pane se llame exactamente como dice `HERDR_PANE_KIMI` en `.env`.

### Jules no ejecuta

Revisar que Jules esté habilitado en el repo y que Kimi haya creado el issue con instrucciones claras.

## Seguridad

- No commitear `.env`.
- Cambiar la contraseña de root después del setup.
- Usar SSH keys en lugar de contraseña.
- Limitar el puerto del webhook si es posible.
