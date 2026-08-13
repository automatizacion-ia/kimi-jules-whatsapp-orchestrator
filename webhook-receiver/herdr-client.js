const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

const PANE_KIMI = process.env.HERDR_PANE_KIMI || 'w1:p1';

/**
 * Ejecuta un comando de Herdr.
 * El servicio corre como usuario 'herdr' con HOME=/var/lib/herdr,
 * por lo que herdr CLI encuentra el socket automáticamente.
 */
async function herdr(command) {
  const fullCmd = `herdr ${command}`;
  const { stdout, stderr } = await execAsync(fullCmd, {
    timeout: 15000,
    env: {
      ...process.env,
      // Asegurar que herdr CLI encuentre el socket del server
      HOME: process.env.HERDR_HOME || '/var/lib/herdr',
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
 * Envía un mensaje al pane de Kimi dentro de Herdr y presiona Enter.
 */
async function sendToKimi(message) {
  // Escapar comillas dobles para el shell
  const sanitized = message.replace(/"/g, '\\"');
  return herdr(`pane run "${PANE_KIMI}" "${sanitized}"`);
}

/**
 * Captura el output reciente del pane de Kimi.
 */
async function captureKimiOutput(lines = 80) {
  return herdr(`pane read "${PANE_KIMI}" --lines ${lines}`);
}

/**
 * Envía texto literal al pane de Kimi (sin presionar Enter).
 */
async function sendTextToKimi(text) {
  const sanitized = text.replace(/"/g, '\\"');
  return herdr(`pane send-text "${PANE_KIMI}" "${sanitized}"`);
}

module.exports = {
  sendToKimi,
  sendTextToKimi,
  captureKimiOutput,
};
