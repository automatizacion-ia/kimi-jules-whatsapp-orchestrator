const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

const WORKSPACE = process.env.HERDR_WORKSPACE || 'main';
const PANE_KIMI = process.env.HERDR_PANE_KIMI || 'kimi';

/**
 * Envía un mensaje al pane de Kimi dentro de Herdr.
 * NOTA: el comando exacto depende de la versión de Herdr.
 * Ajustá según `herdr --help` en la VM.
 */
async function sendToKimi(message) {
  const sanitized = message.replace(/"/g, '\\"');

  // Intentos con distintos comandos posibles de Herdr.
  const candidates = [
    `herdr send --workspace "${WORKSPACE}" --pane "${PANE_KIMI}" "${sanitized}"`,
    `herdr send --pane "${PANE_KIMI}" "${sanitized}"`,
    `herdr send "${PANE_KIMI}" "${sanitized}"`,
    `herdr send-keys --workspace "${WORKSPACE}" --pane "${PANE_KIMI}" "${sanitized}"`,
    `herdr type --workspace "${WORKSPACE}" --pane "${PANE_KIMI}" "${sanitized}"`,
  ];

  for (const cmd of candidates) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
      if (stderr && stderr.toLowerCase().includes('error')) continue;
      return { ok: true, cmd, stdout, stderr };
    } catch (err) {
      // Probar siguiente comando
    }
  }

  throw new Error(`No se pudo enviar mensaje a Kimi. Probá los comandos manualmente con: herdr --help`);
}

/**
 * Captura el output del pane de Kimi.
 * NOTA: el comando exacto depende de la versión de Herdr.
 */
async function captureKimiOutput(lines = 50) {
  const candidates = [
    `herdr capture --workspace "${WORKSPACE}" --pane "${PANE_KIMI}" --lines ${lines}`,
    `herdr capture --pane "${PANE_KIMI}" --lines ${lines}`,
    `herdr capture "${PANE_KIMI}"`,
    `herdr print --workspace "${WORKSPACE}" --pane "${PANE_KIMI}"`,
  ];

  for (const cmd of candidates) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
      if (stderr && stderr.toLowerCase().includes('error')) continue;
      return stdout || stderr;
    } catch (err) {
      // Probar siguiente comando
    }
  }

  throw new Error(`No se pudo capturar output de Kimi. Probá los comandos manualmente con: herdr --help`);
}

/**
 * Envía un comando directo al pane de Kimi y presiona Enter.
 */
async function sendCommandToKimi(command) {
  // Primero envía el comando como texto
  await sendToKimi(command);
  // Luego envía Enter
  try {
    await execAsync(`herdr send-keys --workspace "${WORKSPACE}" --pane "${PANE_KIMI}" "Return"`, { timeout: 5000 });
  } catch (err) {
    // Algunas versiones no necesitan send-keys separado
  }
}

module.exports = {
  sendToKimi,
  sendCommandToKimi,
  captureKimiOutput,
};
