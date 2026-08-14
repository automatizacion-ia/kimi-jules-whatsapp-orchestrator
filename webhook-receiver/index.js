require('dotenv').config();

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { exec } = require('child_process');
const util = require('util');
const herdr = require('./herdr-client');

const execAsync = util.promisify(exec);

const PORT = process.env.WEBHOOK_PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'automatizacion-ia';
const GITHUB_DEFAULT_REPO = process.env.GITHUB_DEFAULT_REPO || '';
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '';
const SESSION_NAME = process.env.WHATSAPP_SESSION_NAME || 'mfco-session';

const app = express();
app.use(express.json());

let whatsappClient = null;
let whatsappReady = false;
const QR_PATH = path.join(__dirname, 'qr.png');
const SESSION_DIR = path.join(__dirname, `.wwebjs_auth_${SESSION_NAME}`);

// Aprobaciones pendientes de issues/PRs de GitHub
const pendingApprovals = new Map();

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
 * Guarda el QR como imagen PNG y lo imprime en terminal.
 */
async function saveQr(qrString) {
  try {
    await qrcode.toFile(QR_PATH, qrString, { width: 512 });
    console.log(`[WhatsApp] QR guardado en: ${QR_PATH}`);
    console.log('\n📱 Escanea este QR con WhatsApp:\n');
    qrcodeTerminal.generate(qrString, { small: true });
    console.log('\n');
  } catch (err) {
    console.error('[WhatsApp] Error guardando QR:', err.message);
  }
}

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
 * Valida la firma de un webhook de GitHub.
 */
function validateGitHubSignature(req) {
  if (!GITHUB_WEBHOOK_SECRET) return true;
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(req.body));
  const digest = `sha256=${hmac.digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

/**
 * Envía un mensaje de WhatsApp.
 * Intenta resolver LIDs a JIDs reales para evitar errores de envío.
 */
async function sendWhatsAppMessage(to, text) {
  if (!whatsappClient || !whatsappReady) {
    console.error('WhatsApp client no está listo aún');
    return;
  }
  try {
    let target = to;
    if (to.endsWith('@lid')) {
      try {
        const contact = await whatsappClient.getContactById(to);
        target = contact.id?._serialized || to;
        console.log(`[WhatsApp] LID ${to} resuelto a ${target}`);
      } catch (lidErr) {
        console.warn(`[WhatsApp] No se pudo resolver LID ${to}:`, lidErr.message);
      }
    }
    await Promise.race([
      whatsappClient.sendMessage(target, text),
      new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timeout')), 15000)),
    ]);
    console.log(`[WhatsApp] Mensaje enviado a ${target}`);
  } catch (err) {
    console.error('Error enviando mensaje de WhatsApp:', err.message);
  }
}

/**
 * Crea un issue en GitHub usando gh CLI.
 * `repo` puede ser solo el nombre (se resuelve contra GITHUB_ORG) o la ruta completa org/repo.
 */
async function createGitHubIssue(repo, title, body) {
  const fullRepo = repo.includes('/') ? repo : `${GITHUB_ORG}/${repo}`;
  const cmd = `GH_TOKEN="${GITHUB_TOKEN}" gh issue create --repo "${fullRepo}" --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: 15000 });
    return { ok: true, url: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Agrega un comentario a un issue o PR de GitHub.
 */
async function commentOnGitHub(fullRepo, number, body) {
  const cmd = `GH_TOKEN="${GITHUB_TOKEN}" gh issue comment "${number}" --repo "${fullRepo}" --body "${body.replace(/"/g, '\\"')}"`;
  try {
    await execAsync(cmd, { timeout: 15000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Envía un prompt a Kimi y devuelve su respuesta limpia.
 */
async function askKimi(prompt) {
  await herdr.sendToKimi(prompt);
  const waitTime = parseInt(process.env.KIMI_RESPONSE_TIMEOUT_MS, 10) || 30000;
  await new Promise((resolve) => setTimeout(resolve, waitTime));
  const output = await herdr.captureKimiOutput(120);
  return herdr.extractKimiResponse(output) || 'Kimi no generó una respuesta visible.';
}

/**
 * Analiza un issue o PR de GitHub con Kimi.
 */
async function analyzeGitHubItem(type, repo, number, title, body, author) {
  const prompt = `Analizá este ${type} de GitHub en español y responde de forma concisa:

Repo: ${repo}
Número: #${number}
Autor: ${author}
Título: ${title}
Cuerpo: ${body || '(sin descripción)'}

Respondé exactamente con estos 4 puntos numerados:
1. Qué pide o qué problema resuelve.
2. Cómo se podría implementar o arreglar.
3. Posibles impedimentos o riesgos.
4. Si es pertinente aplicarlo o por qué no lo sería.`;

  return askKimi(prompt);
}

/**
 * Notifica al administrador por WhatsApp sobre un issue/PR nuevo.
 */
async function notifyAdminAboutGitHubItem(type, fullRepo, number, title, url, analysis) {
  if (!ADMIN_WHATSAPP_NUMBER) {
    console.log('[GitHub] ADMIN_WHATSAPP_NUMBER no configurado, no se envía notificación');
    return;
  }

  const itemType = type === 'pull_request' ? 'Pull request' : 'Issue';
  const approvalId = `${fullRepo}#${number}`;

  const message = [
    `🔔 Nuevo ${itemType.toLowerCase()} en *${fullRepo}*`,
    ``,
    `*#${number}:* ${title}`,
    `*URL:* ${url}`,
    ``,
    `*Análisis de Kimi:*`,
    analysis,
    ``,
    `¿Querés que se lo asigne a Jules?`,
    `Respondé: *si* para aprobar, *no* para rechazar.`,
    `ID: ${approvalId}`,
  ].join('\n');

  await sendWhatsAppMessage(ADMIN_WHATSAPP_NUMBER, message);
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

  const lowerText = text.toLowerCase().trim();

  // Respuesta a aprobación de issue/PR
  if (lowerText === 'si' || lowerText === 'sí' || lowerText === 'aprobar' || lowerText === 'ok') {
    await handleApproval(from, true);
    return;
  }
  if (lowerText === 'no' || lowerText === 'rechazar' || lowerText === 'cancelar') {
    await handleApproval(from, false);
    return;
  }

  // Patrón especial: si el mensaje empieza con /github, crear issue directo
  if (text.startsWith('/github')) {
    const rest = text.replace('/github', '').trim();
    const [repo, ...titleParts] = rest.split(' ');
    const title = titleParts.join(' ') || 'Tarea solicitada por WhatsApp';
    const targetRepo = repo || GITHUB_DEFAULT_REPO;

    if (!targetRepo) {
      await sendWhatsAppMessage(from, '❌ Faltó el nombre del repo. Usá: /github nombre-repo título del issue. También podés usar /github org/repo título.');
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
    const response = await askKimi(text);
    await sendWhatsAppMessage(from, response);

    // Si Kimi menciona que necesita Jules y hay un repo por defecto, crear issue automáticamente
    if (GITHUB_DEFAULT_REPO && (response.toLowerCase().includes('jules') || response.toLowerCase().includes('github'))) {
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
 * Maneja la aprobación o rechazo del último issue/PR notificado.
 */
async function handleApproval(from, approved) {
  if (pendingApprovals.size === 0) {
    await sendWhatsAppMessage(from, 'No tengo ningún issue o PR pendiente de aprobación.');
    return;
  }

  // Tomar el más reciente
  const [approvalId, item] = Array.from(pendingApprovals.entries()).pop();
  pendingApprovals.delete(approvalId);

  if (approved) {
    const mention = item.type === 'pull_request'
      ? `@jules revisá este PR y aplicá los cambios si corresponde.`
      : `@jules implementá esto según el análisis.`;

    const result = await commentOnGitHub(item.fullRepo, item.number, mention);
    if (result.ok) {
      await sendWhatsAppMessage(from, `✅ Le avisé a Jules en ${approvalId}.`);
    } else {
      await sendWhatsAppMessage(from, `❌ No pude asignarle a Jules: ${result.error}`);
    }
  } else {
    await sendWhatsAppMessage(from, `🚫 Ok, no le digo nada a Jules sobre ${approvalId}.`);
  }
}

/**
 * Endpoint para recibir webhooks de WhatsApp.
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
 * Endpoint para recibir webhooks de GitHub (issues y pull requests).
 */
app.post('/webhook/github', async (req, res) => {
  if (!validateGitHubSignature(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.headers['x-github-event'];
  const payload = req.body || {};

  if ((event === 'issues' && payload.action === 'opened') || (event === 'pull_request' && payload.action === 'opened')) {
    const item = event === 'issues' ? payload.issue : payload.pull_request;
    if (!item) {
      return res.status(400).json({ error: 'Missing issue/PR data' });
    }

    const fullRepo = payload.repository?.full_name || '';
    const number = item.number;
    const title = item.title || '';
    const bodyText = item.body || '';
    const url = item.html_url || '';
    const author = item.user?.login || 'desconocido';
    const type = event === 'issues' ? 'issue' : 'pull_request';

    res.json({ status: 'received' });

    try {
      const analysis = await analyzeGitHubItem(type, fullRepo, number, title, bodyText, author);
      const approvalId = `${fullRepo}#${number}`;
      pendingApprovals.set(approvalId, { type, fullRepo, number, title, url, analysis });
      await notifyAdminAboutGitHubItem(type, fullRepo, number, title, url, analysis);
    } catch (err) {
      console.error('[GitHub] Error procesando webhook:', err);
    }
    return;
  }

  res.json({ status: 'ignored' });
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
  res.json({ status: 'ok', whatsappReady });
});

/**
 * Inicia whatsapp-web.js.
 */
async function startWhatsApp() {
  // Limpiar sesión previa para evitar corrupción
  cleanSession();

  try {
    whatsappClient = new Client({
      authStrategy: new LocalAuth({
        clientId: SESSION_NAME,
        dataPath: path.join(__dirname, '.wwebjs_auth'),
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
        ],
      },
    });

    whatsappClient.on('qr', async (qr) => {
      console.log('[WhatsApp] QR recibido, escaneá el código para continuar');
      await saveQr(qr);
    });

    whatsappClient.on('ready', () => {
      whatsappReady = true;
      console.log('[WhatsApp] Cliente listo');
      // Limpiar QR una vez autenticado
      if (fs.existsSync(QR_PATH)) {
        fs.unlinkSync(QR_PATH);
      }
    });

    whatsappClient.on('auth_failure', (msg) => {
      console.error('[WhatsApp] Fallo de autenticación:', msg);
    });

    whatsappClient.on('disconnected', (reason) => {
      console.log('[WhatsApp] Desconectado:', reason);
      whatsappReady = false;
    });

    whatsappClient.on('message_create', async (message) => {
      if (message.fromMe) return;
      // Ignorar estados de WhatsApp y broadcasts
      if (message.from === 'status@broadcast' || message.id?.remote === 'status@broadcast') {
        return;
      }
      // Usar el chat real si está disponible; de lo contrario el from del mensaje
      const chatId = message.from;
      await processMessage(chatId, message.body || '');
    });

    await whatsappClient.initialize();
  } catch (err) {
    console.error('[WhatsApp] Error iniciando whatsapp-web.js:', err);
    process.exit(1);
  }
}

app.listen(PORT, () => {
  console.log(`[Webhook] Escuchando en puerto ${PORT}`);
});

startWhatsApp();
