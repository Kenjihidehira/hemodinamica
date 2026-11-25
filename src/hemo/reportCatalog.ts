/**
 * Listas fixas do laudo estruturado. Ficam num arquivo sem dependências para que o esquema
 * (domain.ts) e as regras do laudo (report.ts) usem as mesmas opções.
 * Os nomes seguem a divisão usual da árvore coronária; o serviço pode ajustar a lista.
 */
export const arteries = ['Tronco', 'Descendente anterior', 'Circunflexa', 'Coronária direita', 'Enxertos'] as const;
export type Artery = typeof arteries[number];

export const coronarySegments = [
  { name: 'Tronco da coronária esquerda', artery: 'Tronco' },
  { name: 'Descendente anterior proximal', artery: 'Descendente anterior' },
  { name: 'Descendente anterior média', artery: 'Descendente anterior' },
  { name: 'Descendente anterior distal', artery: 'Descendente anterior' },
  { name: 'Primeira diagonal', artery: 'Descendente anterior' },
  { name: 'Segunda diagonal', artery: 'Descendente anterior' },
  { name: 'Ramo intermédio', artery: 'Circunflexa' },
  { name: 'Circunflexa proximal', artery: 'Circunflexa' },
  { name: 'Circunflexa distal', artery: 'Circunflexa' },
  { name: 'Primeira marginal', artery: 'Circunflexa' },
  { name: 'Segunda marginal', artery: 'Circunflexa' },
  { name: 'Coronária direita proximal', artery: 'Coronária direita' },
  { name: 'Coronária direita média', artery: 'Coronária direita' },
  { name: 'Coronária direita distal', artery: 'Coronária direita' },
  { name: 'Descendente posterior', artery: 'Coronária direita' },
  { name: 'Ventricular posterior', artery: 'Coronária direita' },
  { name: 'Enxerto de veia safena', artery: 'Enxertos' },
  { name: 'Enxerto de artéria mamária', artery: 'Enxertos' },
] as const satisfies readonly { name: string; artery: Artery }[];
export const segmentNames = coronarySegments.map(s => s.name) as [typeof coronarySegments[number]['name'], ...typeof coronarySegments[number]['name'][]];
export type SegmentName = typeof segmentNames[number];

/** Fluxo TIMI (0 = sem fluxo, 3 = fluxo normal). Guardado como texto para aceitar "não informado" (''). */
export const timiGrades = ['0', '1', '2', '3'] as const;
export const calcificationGrades = ['Ausente', 'Leve', 'Moderada', 'Grave'] as const;
export const physiologyKinds = ['FFR', 'iFR'] as const;
export const therapies = ['Tratamento clínico', 'Angioplastia com stent', 'Angioplastia com balão', 'Indicação de cirurgia'] as const;
export type Therapy = typeof therapies[number];
export const isAngioplasty = (t: string) => t === 'Angioplastia com stent' || t === 'Angioplastia com balão';

/**
 * Intercorrências em lista fechada, para que possam ser contadas e comparadas.
 * As definições exatas de cada uma seguem o protocolo do serviço. "Outra" exige descrição.
 */
export const complicationTypes = [
  'Dissecção coronária',
  'Perfuração coronária',
  'No-reflow ou fluxo lento',
  'Oclusão aguda de vaso ou ramo',
  'Arritmia com necessidade de tratamento',
  'Instabilidade hemodinâmica',
  'Reação ao contraste',
  'Sangramento ou hematoma no acesso',
  'AVC ou AIT',
  'Óbito em sala',
  'Outra',
] as const;
export type ComplicationType = typeof complicationTypes[number];
