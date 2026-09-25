import type { StatusDeDisponibilidade, StatusDeUsuario } from './tipos';

/**
 * De onde vem cada trilha da home, para a página "Ver todos" saber o que pedir.
 *
 * A home recebe as trilhas já montadas por `GET /home`, que corta em 24. A
 * página cheia refaz a mesma pergunta em `GET /titles`, sem corte — e é esta
 * tabela que traduz o id da trilha no filtro equivalente. As duas leituras
 * precisam concordar, então o mapeamento fica num lugar só.
 */
export interface FonteDaTrilha {
  titulo: string;
  availability?: StatusDeDisponibilidade;
  status?: StatusDeUsuario;
  /** `?user=` é obrigatório para as trilhas que dependem de quem está logado */
  porUsuario?: boolean;
}

export const FONTES_DAS_TRILHAS: Record<string, FonteDaTrilha> = {
  'em-cartaz': { titulo: 'Em cartaz agora', availability: 'em_cartaz' },
  'pre-estreias': { titulo: 'Pré-estreias', availability: 'pre_estreia' },
  'em-breve': { titulo: 'Em breve', availability: 'em_breve' },
  'marcados': { titulo: 'Já marcados por vocês', status: 'marcado', porUsuario: true },
};

export function fonteDaTrilha(id: string): FonteDaTrilha | null {
  return FONTES_DAS_TRILHAS[id] ?? null;
}
