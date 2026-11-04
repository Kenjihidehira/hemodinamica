# Direção visual e verificação

## Referência atual

O layout usa como referência o tema empresarial do projeto local **Patrimônio Ops Control**, principalmente `app/demo/enterprise.css` e `components/patrimonio/DashboardView.tsx`. A camada `src/jusimed-theme.css` adapta esse layout às cores aproximadas do logotipo público da Jusimed, sem incorporar marcas ou imagens corporativas do Patrimônio Ops.

| Elemento | Aplicação no protótipo |
| --- | --- |
| Paleta | Azul `#293a78` e vermelho `#c73543` inspirados no logotipo público; fundo claro `#f7f8fb` |
| Estrutura | Cabeçalho superior com marca e menu horizontal, contexto do ambiente, seis KPIs e painéis de análise |
| Estados | Amarelo para risco de validade e vermelho para saldo vencido |
| Dados | Tabelas discretas, barras horizontais e pendências clicáveis |
| Tipografia | Inter com tamanhos compactos e hierarquia operacional |
| Celular | Menu recolhível, KPIs em duas colunas e painéis empilhados |

## Conferência visual

1. **Hierarquia:** título, contexto da base, filtros e indicadores seguem a ordem do Patrimônio Ops.
2. **Navegação:** cabeçalho fixo no topo com logotipo e menu horizontal. No celular, o botão de menu abre um painel sobre o conteúdo, com alvos de toque de pelo menos 44 px, seção atual destacada e fechamento por seleção, toque fora ou Esc. Em telas de até 360 px, as opções ficam em uma coluna.
3. **KPIs:** seis indicadores em uma faixa, separados por divisórias, com navegação para detalhe.
4. **Painéis:** atenção da gestão, distribuição, fluxo, tendência e cobertura preservam densidade empresarial.
5. **Cor e controle:** azul de ação, amarelo de alerta, bordas discretas e controles pequenos.
6. **Responsividade:** verificada em 390 px, sem rolagem horizontal da página.

## Limites da referência

O Patrimônio Ops trabalha com ativos, custódia, núcleos e manutenção. Esta proposta trabalha com produtos, lotes, validade e locais. Os indicadores foram adaptados ao domínio médico; resultados, datas e movimentações continuam fictícios. As cores não substituem um manual de marca oficial.
