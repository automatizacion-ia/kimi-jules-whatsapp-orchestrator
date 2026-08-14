const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// Detecta el pane de Kimi automáticamente o usa HERDR_PANE_KIMI
let PANE_KIMI = process.env.HERDR_PANE_KIMI || '';

/**
 * Ejecuta un comando de Herdr.
 * El servicio corre como usuario 'root' con HOME=/root,
 * por lo que herdr CLI encuentra el socket automáticamente.
 */
async function herdr(command) {
  const fullCmd = `herdr ${command}`;
  const { stdout, stderr } = await execAsync(fullCmd, {
    timeout: 15000,
    env: {
      ...process.env,
      // Asegurar que herdr CLI encuentre el socket del server
      HOME: process.env.HOME || '/root',
      PATH: `${process.env.PATH}:/usr/local/bin:/root/.local/bin`,
    },
  });

  if (stderr && !stderr.includes('warning')) {
    // Algunos comandos imprimen info en stderr
    console.warn('[herdr stderr]', stderr);
  }
  return stdout;
}

/**
 * Detecta el pane actual de Kimi.
 */
async function detectKimiPane() {
  if (PANE_KIMI) return PANE_KIMI;
  try {
    const output = await herdr('workspace list');
    const data = JSON.parse(output);
    const workspace = data.result?.workspaces?.[0];
    if (workspace) {
      PANE_KIMI = `${workspace.workspace_id}:p1`;
      return PANE_KIMI;
    }
  } catch (err) {
    console.error('[herdr] Error detectando pane:', err.message);
  }
  return 'w1:p1';
}

/**
 * Envía un mensaje al pane de Kimi dentro de Herdr y presiona Enter.
 */
async function sendToKimi(message) {
  const pane = await detectKimiPane();
  // Escapar comillas dobles para el shell
  const sanitized = message.replace(/"/g, '\\"');
  return herdr(`pane run "${pane}" "${sanitized}"`);
}

/**
 * Captura el output reciente del pane de Kimi.
 */
async function captureKimiOutput(lines = 80) {
  const pane = await detectKimiPane();
  return herdr(`pane read "${pane}" --lines ${lines}`);
}

/**
 * Extrae la última respuesta de Kimi del output crudo del pane,
 * descartando el banner de bienvenida, historial previo y la UI.
 */
function extractKimiResponse(rawOutput) {
  if (!rawOutput) return '';

  const lines = rawOutput.split('\n');

  // Encontrar el último marcador de mensaje del usuario (✨)
  let lastUserLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('✨')) {
      lastUserLine = i;
      break;
    }
  }

  // Si no hay mensaje de usuario, buscar desde el principio
  const startLine = lastUserLine >= 0 ? lastUserLine : 0;

  // Encontrar los bloques de respuesta (●) después del último mensaje del usuario
  const blocks = [];
  let currentBlock = null;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    // Nuevo bloque de respuesta
    const bulletMatch = line.match(/^\s*●\s*(.*)$/);
    if (bulletMatch) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = bulletMatch[1].trim();
      continue;
    }

    // Continuación de un bloque (líneas indentadas o con espacios al inicio)
    if (currentBlock && line.startsWith('  ') && !line.includes('✨') && !line.includes('╭')) {
      const continuation = line.trim();
      if (continuation && !continuation.includes('ctrl+o') && !continuation.includes('more lines')) {
        currentBlock += ' ' + continuation;
      }
    }
  }

  if (currentBlock) blocks.push(currentBlock);

  // La respuesta final es el último bloque (los anteriores suelen ser razonamiento interno)
  const response = blocks.length > 0 ? blocks[blocks.length - 1] : '';

  // Limpiar texto residual de la UI
  return response
    .replace(/Welcome to Kimi Code!.*?Version:\s*[\d.]+/s, '')
    .replace(/Send \/help for help information\./g, '')
    .replace(/Run \/model to switch to K3.*?capability/s, '')
    .replace(/No session yet[\s\S]*?first message\./g, '')
    .replace(/kimi-platform\s*·\s*\+?\d+\s*models?\.?/gi, '')
    .replace(/context:\s*\d+%.*?$/gm, '')
    .replace(/[│╭╮╰╯─]/g, '')
    .trim();
}

/**
 * Envía texto literal al pane de Kimi (sin presionar Enter).
 */
async function sendTextToKimi(text) {
  const pane = await detectKimiPane();
  const sanitized = text.replace(/"/g, '\\"');
  return herdr(`pane send-text "${pane}" "${sanitized}"`);
}

module.exports = {
  sendToKimi,
  sendTextToKimi,
  captureKimiOutput,
  extractKimiResponse,
};
