import { defineConfig, loadEnv } from 'vite';
import { copilotPlugin } from './server/copilot';

// ANTHROPIC_API_KEY vem de .env.local (fora do git) e fica só no servidor:
// sem o prefixo VITE_, o Vite não a envia ao navegador.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [copilotPlugin({ apiKey: env.ANTHROPIC_API_KEY, model: env.HEMO_COPILOT_MODEL })],
  };
});
