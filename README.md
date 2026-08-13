# Kimi + Jules + WhatsApp Orchestrator

Orquestador que corre en una VM de 4 GB con:

- **Herdr**: runtime persistente para agentes CLI.
- **Kimi Code CLI**: recibe mensajes de WhatsApp, planifica y responde.
- **Jules de Google**: ejecuta cambios de código en repositorios de GitHub.
- **open-wa**: recibe y envía mensajes de WhatsApp Web.

## Arquitectura

```text
Usuario de WhatsApp
        ↓
    open-wa (WhatsApp Web)
        ↓
   webhook-receiver (Node.js)
        ↓
    Kimi dentro de Herdr
        ↓
   ├─ Respuesta simple → WhatsApp
   └─ Necesita código → GitHub issue/PR → Jules de Google
```

## Requisitos

- VPS con Ubuntu 24.04 (o similar).
- 4 GB de RAM mínimo.
- Acceso SSH.
- Cuenta de GitHub con acceso a la organización `automatizacion-ia`.
- Jules de Google habilitado en los repos donde va a trabajar.
- Número de WhatsApp para escanear con open-wa (recomendado secundario).

## Advertencias

- open-wa **no es oficial**. WhatsApp puede banear el número.
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

Recomendado correr con PM2 o systemd en producción.

### 6. Configurar open-wa

open-wa se levanta desde el mismo `webhook-receiver`. La primera vez escanear el QR desde la consola. La sesión se guarda en `./session`.

### 7. Configurar GitHub

- Crear un Personal Access Token con permisos `repo`.
- Agregarlo en `.env` como `GITHUB_TOKEN`.
- Habilitar Jules de Google en los repositorios objetivo.

## Flujo de un mensaje

1. Alguien escribe por WhatsApp.
2. open-wa recibe y POSTea a `http://localhost:3000/webhook/whatsapp`.
3. El webhook valida el secreto y le pasa el mensaje a Kimi via Herdr.
4. Kimi decide:
   - Responde directo → se envía por WhatsApp.
   - Necesita código → crea un issue/PR en GitHub con `gh` o la API.
5. Jules de Google detecta el issue/PR y ejecuta el cambio.
6. Una GitHub Action o webhook puede notificar a Kimi para responder al usuario.

## Variables de entorno

Ver `.env.example`.

## Troubleshooting

### open-wa consume mucha RAM

Verificar flags de Chromium en `webhook-receiver/index.js`. Si sigue alto, considerar swap o WhatsApp Cloud API.

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
