/** Cliente do copilot. Fala só com /api/copilot no próprio servidor local; a chave nunca passa pelo navegador. */
export type Briefing = { resumo: string; alertas: { nivel: 'alto' | 'atenção' | 'informação'; titulo: string; detalhe: string }[]; perguntasEmAberto: string[] };
export type LaudoDraft = { descricao: string; conclusao: string; pontosParaRevisar: string[] };
export type Answer = { resposta: string; pontosParaRevisar: string[] };
export type Appeal = { texto: string; argumentos: string[]; documentosParaAnexar: string[] };
type Results = { briefing: Briefing; laudo: LaudoDraft; pergunta: Answer; recurso: Appeal };

export async function copilotStatus(): Promise<{ configured: boolean; model: string } | null> {
  try { const res = await fetch('/api/copilot/status'); return res.ok ? await res.json() : null; } catch { return null; }
}
export async function askCopilot<T extends keyof Results>(task: T, context: object, question?: string): Promise<Results[T]> {
  let res: Response;
  try { res = await fetch('/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, context, question }) }); }
  catch { throw new Error('Servidor do copilot indisponível. Rode o sistema com "pnpm dev".'); }
  const body = await res.json().catch(() => null) as { result?: Results[T]; error?: string } | null;
  if (!res.ok || !body?.result) throw new Error(body?.error ?? 'O copilot não respondeu. Rode o sistema com "pnpm dev" e tente de novo.');
  return body.result;
}
