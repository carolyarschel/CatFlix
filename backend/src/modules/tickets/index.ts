export {
  cadastrarIngresso,
  editarIngresso,
  ingressosAtivos,
  ingressosDoTitulo,
  marcarComoAssistido,
  limparCodigos,
  removerIngresso,
} from './tickets.service';
export type { IngressoComprado } from './tickets.service';
export {
  ANTECEDENCIA_DO_LEMBRETE_MS,
  conteudoDoLembrete,
  enviarLembretesPendentes,
  iniciarLembretesDeIngresso,
  pararLembretesDeIngresso,
} from './tickets.lembrete';
export { ticketsRoutes } from './tickets.routes';
