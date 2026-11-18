// Sem rotas próprias: `PUT /titles/:id/rating` mora no orquestrador `library`,
// porque só dá nota quem assistiu, e isso cruza com `watches`.
export {
  definirNota,
  notasDoTitulo,
  removerNota,
  removerNotasDoTitulo,
  restaurarNotasDoTitulo,
  validarNota,
} from './ratings.service';
export type { NotaDaPessoa } from './ratings.service';
