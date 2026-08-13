require('dotenv').config();

const express = require('express');
const wa = require('@open-wa/wa-automate');
const { ev } = require('@open-wa/wa-automate');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const herdr = require('./herdr-client');

const execAsync = util.promisify(exec);

const PORT = process.env.WEBHOOK_PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'automatizacion-ia';
const GITHUB_DEFAULT_REPO = process.env.GITHUB_DEFAULT_REPO || '';
const SESSION_NAME = process.env.OPEN_WA_SESSION_NAME || 'mfco-session';

const app = express();
app.use(express.json());

let whatsappClient = null;
const QR_PATH = path.join(__dirname, 'qr.png');
const SESSION_DIR = path.join(__dirname, `_IGNORE_${SESSION_NAME}`);

/**
 * Borra datos de sesión previos para evitar corrupción al re-escanear.
 */
function cleanSession() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log(`[WhatsApp] Sesión anterior borrada: ${SESSION_DIR}`);
    }
  } catch (err) {
    console.error('[WhatsApp] Error borrando sesión:', err.message);
  }
}

/**
 * Guarda el QR como imagen PNG y también lo imprime como ASCII en el log.
 */
function saveQr(qrcode) {
  try {
    // open-wa suele emitir el QR como data URL base64
    const base64 = qrcode.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(QR_PATH, Buffer.from(base64, 'base64'));
    console.log(`[WhatsApp] QR guardado en: ${QR_PATH}`);
  } catch (err) {
    console.error('[WhatsApp] Error guardando QR:', err.message);
  }
}

// Listeners de eventos QR (varios patrones por compatibilidad)
ev.on('qr.**', saveQr);
ev.on('qr', saveQr);
ev.on('qr.*', saveQr);

ev.on('sessionData.**', (data) => {
  console.log('[WhatsApp] Datos de sesión recibidos (se guardarán automáticamente)');
});

ev.on('error.**', (err) => {
  console.error('[WhatsApp] Evento de error:', err);
});

/**
 * Valida el secreto del webhook entrante.
 */
function validateSecret(req) {
  const incoming = req.headers['x-webhook-secret'] || req.body?.secret || '';
  if (WEBHOOK_SECRET && incoming !== WEBHOOK_SECRET) {
    return false;
  }
  return true;
}

/**
 * Envía un mensaje de WhatsApp.
 */
async function sendWhatsAppMessage(to, text) {
  if (!whatsappClient) {
    console.error('WhatsApp client no está listo aún');
    return;
  }
  try {
    await whatsappClient.sendText(to, text);
  } catch (err) {
    console.error('Error enviando mensaje de WhatsApp:', err.message);
  }
}

/**
 * Crea un issue en GitHub usando gh CLI.
 */
async function createGitHubIssue(repo, title, body) {
  const fullRepo = `${GITHUB_ORG}/${repo}`;
  const cmd = `GH_TOKEN="${GITHUB_TOKEN}" gh issue create --repo "${fullRepo}" --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: 15000 });
    return { ok: true, url: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Procesa un mensaje entrante de WhatsApp.
 */
async function processMessage(from, text) {
  console.log(`[WhatsApp] Mensaje de ${from}: ${text}`);

  // Ignorar mensajes del propio bot o de grupos
  if (from.includes('@g.us')) {
    console.log('[WhatsApp] Ignorando mensaje de grupo');
    return;
  }

  // Patrón especial: si el mensaje empieza con /github, crear issue directo
  if (text.startsWith('/github')) {
    const rest = text.replace('/github', '').trim();
    const [repo, ...titleParts] = rest.split(' ');
    const title = titleParts.join(' ') || 'Tarea solicitada por WhatsApp';
    const targetRepo = repo || GITHUB_DEFAULT_REPO;

    if (!targetRepo) {
      await sendWhatsAppMessage(from, '❌ No configuré un repo por defecto. Usá: /github nombre-repo título del issue');
      return;
    }

    const result = await createGitHubIssue(targetRepo, title, `Solicitado desde WhatsApp por ${from}`);
    if (result.ok) {
      await sendWhatsAppMessage(from, `✅ Issue creado: ${result.url}\nJules de Google lo procesará.`);
    } else {
      await sendWhatsAppMessage(from, `❌ No pude crear el issue: ${result.error}`);
    }
    return;
  }

  // Flujo normal: enviar a Kimi
  await sendWhatsAppMessage(from, '⏳ Procesando con Kimi...');

  try {
    // Enviar el mensaje al pane de Kimi
    await herdr.sendToKimi(text);

    // Darle tiempo a Kimi para responder (ajustable)
    const waitTime = parseInt(process.env.KIMI_RESPONSE_TIMEOUT_MS, 10) || 30000;
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Capturar respuesta
    const output = await herdr.captureKimiOutput(80);

    // Limpiar output (opcional)
    const response = output.trim() || 'Kimi no generó una respuesta visible.';

    await sendWhatsAppMessage(from, response);

    // Si Kimi menciona que necesita Jules, crear issue automáticamente
    if (response.toLowerCase().includes('jules') || response.toLowerCase().includes('github')) {
      const result = await createGitHubIssue(GITHUB_DEFAULT_REPO, `Tarea derivada de WhatsApp: ${text.slice(0, 50)}`, `Solicitud original: ${text}`);
      if (result.ok) {
        await sendWhatsAppMessage(from, `🚀 También creé un issue para Jules: ${result.url}`);
      }
    }
  } catch (err) {
    console.error('Error procesando mensaje:', err);
    await sendWhatsAppMessage(from, `❌ Error: ${err.message}`);
  }
}

/**
 * Endpoint para recibir webhooks de open-wa.
 */
app.post('/webhook/whatsapp', async (req, res) => {
  if (!validateSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { from, body } = req.body || {};
  if (!from || !body) {
    return res.status(400).json({ error: 'Missing from or body' });
  }

  // Responder rápido al webhook y procesar asíncrono
  res.json({ status: 'received' });
  await processMessage(from, body);
});

/**
 * Endpoint para enviar mensajes manualmente.
 */
app.post('/send', async (req, res) => {
  if (!validateSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { to, text } = req.body || {};
  if (!to || !text) {
    return res.status(400).json({ error: 'Missing to or text' });
  }

  await sendWhatsAppMessage(to, text);
  res.json({ status: 'sent' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', whatsappReady: !!whatsappClient });
});

/**
 * Inicia open-wa.
 */
async function startWhatsApp() {
  // Limpiar sesión previa para evitar corrupción
  cleanSession();

  try {
    whatsappClient = await wa.create({
      sessionId: SESSION_NAME,
      multiDevice: true,
      authTimeout: 120,
      qrTimeout: 120,
      headless: true,
      useChrome: true,
      blockCrashLogs: true,
      disableSpins: true,
      skipUpdateCheck: true,
      logConsole: false,
      popup: false,
      chromiumArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
      ],
      puppeteerOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
        ],
      },
    });

    console.log('[WhatsApp] Cliente listo');

    // Limpiar QR una vez autenticado
    if (fs.existsSync(QR_PATH)) {
      fs.unlinkSync(QR_PATH);
    }

    whatsappClient.onMessage(async (message) => {
      if (message.fromMe) return;
      await processMessage(message.from, message.body);
    });
  } catch (err) {
    console.error('[WhatsApp] Error iniciando open-wa:', err);
    process.exit(1);
  }
}

app.listen(PORT, () => {
  console.log(`[Webhook] Escuchando en puerto ${PORT}`);
});

startWhatsApp();
