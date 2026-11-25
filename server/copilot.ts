/**
 * Copilot do médico: rota /api/copilot servida pelo próprio Vite (dev e preview).
 * A chave da API fica só neste processo Node; o navegador nunca a recebe.
 * O navegador manda apenas dados clínicos do caso, sem nome ou contato do paciente.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const SYSTEM = `Você é o copilot clínico de um serviço de hemodinâmica, usado por médicos hemodinamicistas dentro do sistema do hospital. Você recebe os dados estruturados de um procedimento, sem identificação do paciente, e ajuda o médico a se preparar e a documentar.

Regras:
- Você apoia; quem decide é sempre o médico. Escreva como sugestão para revisão, nunca como ordem.
- Use somente os dados recebidos. Não invente valores, achados, exames, medicamentos nem materiais. Quando faltar um dado importante, diga qual é.
- Não prescreva doses nem trate um protocolo como regra; quando a conduta depender disso, indique que segue o protocolo do serviço.
- Escreva em português do Brasil, com linguagem médica objetiva e frases curtas.
- Os dados desta instalação são de demonstração (fictícios).`;

const briefing = z.object({
  resumo: z.string().describe('Um parágrafo curto com o essencial do caso para o médico ler antes de entrar na sala.'),
  alertas: z.array(z.object({ nivel: z.enum(['alto', 'atenção', 'informação']), titulo: z.string(), detalhe: z.string() })).describe('Alertas de segurança, do mais grave para o menos grave.'),
  perguntasEmAberto: z.array(z.string()).describe('O que o médico ainda precisa confirmar antes do procedimento.'),
});
const laudo = z.object({
  descricao: z.string().describe('Descrição técnica do procedimento em parágrafos.'),
  conclusao: z.string().describe('Conclusão em até 3 linhas.'),
  pontosParaRevisar: z.array(z.string()).describe('Dados ausentes ou pontos que o médico deve conferir antes de assinar.'),
});
const resposta = z.object({ resposta: z.string(), pontosParaRevisar: z.array(z.string()) });
const recurso = z.object({
  texto: z.string().describe('Texto do recurso de glosa, formal e objetivo, pronto para o faturamento revisar.'),
  argumentos: z.array(z.string()).describe('Argumentos clínicos e documentais usados, cada um apoiado nos dados do caso.'),
  documentosParaAnexar: z.array(z.string()).describe('Documentos do prontuário que sustentam o recurso (ex.: laudo assinado, etiqueta do implante, guia).'),
});

const tasks = {
  briefing: { schema: briefing, prompt: 'Prepare o resumo pré-procedimento. Nos alertas, considere alergias, função renal e uso de contraste, anticoagulação e antiagregação, comorbidades relevantes e itens de preparo pendentes. Inclua os alertas do sistema que estiverem nos dados, com a sua leitura clínica.' },
  laudo: { schema: laudo, prompt: 'Redija o rascunho do laudo deste procedimento a partir do registro da sala, dos achados e dos materiais usados. Na descrição, cubra via de acesso, técnica, achados por vaso com o grau de estenose, tratamento realizado com os materiais, volume de contraste, tempo de fluoroscopia, dose e intercorrências. Não preencha nada que não esteja nos dados.' },
  pergunta: { schema: resposta, prompt: 'Responda à pergunta do médico sobre este caso.' },
  recurso: { schema: recurso, prompt: 'O convênio glosou um item desta conta (veja "glosa" nos dados). Redija o recurso de glosa: explique por que o item foi necessário com base na indicação, nos achados, no registro da sala e na autorização. Se os dados não sustentam o recurso, diga isso com clareza no texto em vez de forçar argumentos.' },
} as const;

const requestSchema = z.object({
  task: z.enum(['briefing', 'laudo', 'pergunta', 'recurso']),
  context: z.record(z.string(), z.unknown()),
  question: z.string().trim().max(2000).optional(),
});

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function readBody(req: IncomingMessage, limit = 100_000) {
  return new Promise<string>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) { reject(new Error('Pedido grande demais.')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function copilotPlugin(options: { apiKey?: string; model?: string }): Plugin {
  const model = options.model || 'claude-opus-5-5';
  const client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : null;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && (req.url === '/status' || req.url === '/status/')) return send(res, 200, { configured: !!client, model });
    if (req.method !== 'POST' || (req.url !== '/' && req.url !== '')) return send(res, 404, { error: 'Rota não encontrada.' });
    if (!client) return send(res, 503, { error: 'Copilot sem chave. Crie o arquivo .env.local com ANTHROPIC_API_KEY=... e reinicie o servidor.' });
    let input: z.infer<typeof requestSchema>;
    try { input = requestSchema.parse(JSON.parse(await readBody(req))); }
    catch { return send(res, 400, { error: 'Pedido inválido para o copilot.' }); }
    if (input.task === 'pergunta' && !input.question) return send(res, 400, { error: 'Escreva a pergunta.' });

    const task = tasks[input.task];
    const content = `<dados_do_caso>\n${JSON.stringify(input.context, null, 2)}\n</dados_do_caso>\n\n${task.prompt}${input.question ? `\n\n<pergunta>${input.question}</pergunta>` : ''}`;
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(task.schema) },
      });
      if (response.stop_reason === 'refusal') return send(res, 422, { error: 'O copilot não respondeu a este pedido. Reformule ou siga sem ele.' });
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) return send(res, 502, { error: 'A resposta do copilot veio incompleta. Tente de novo.' });
      return send(res, 200, { task: input.task, model: response.model, result: response.parsed_output });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return send(res, 502, { error: 'A chave da API foi recusada. Confira ANTHROPIC_API_KEY no .env.local.' });
      if (error instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Limite de uso da API atingido. Aguarde um pouco e tente de novo.' });
      if (error instanceof Anthropic.APIError) return send(res, 502, { error: `A API do copilot respondeu com erro ${error.status ?? ''}.`.trim() });
      return send(res, 502, { error: 'Não foi possível falar com o copilot. Confira a conexão.' });
    }
  }
  // Não devolver nada: se o gancho devolver uma função, o Vite a executa depois como "post hook".
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => unknown } }): void => {
    server.middlewares.use('/api/copilot', (req, res) => { void handle(req, res); });
  };
  return { name: 'hemo-copilot', configureServer: mount, configurePreviewServer: mount };
}
