import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type { EstadoDeUsuario, PerfilDoApp, StatusDeUsuario } from '../api/tipos';

/**
 * O que a pessoa diz sobre o filme (§6, passo 11): quero ver, marcado, visto.
 *
 * Separado de `Availability`, que é o que a fonte diz. Escreve pelo
 * `PUT /users/:id/titles/:id/state`, e o `DELETE` desmarca.
 *
 * O estado local é otimista: marcar um filme tem de responder na hora, e o
 * caminho de volta em caso de erro é restaurar o que havia antes — sem isso a
 * tela ficaria mostrando uma marcação que o servidor recusou.
 */
export function useEstadoDoTitulo(
  perfil: PerfilDoApp,
  titleId: string,
  inicial: EstadoDeUsuario[],
): {
  estados: EstadoDeUsuario[];
  meuStatus: StatusDeUsuario | null;
  salvando: boolean;
  erro: string | null;
  definir: (status: StatusDeUsuario | null) => Promise<void>;
} {
  const [estados, setEstados] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const perfilId = perfil.id;
  const meuStatus = estados.find((e) => e.userId === perfilId)?.status ?? null;

  const definir = useCallback(
    async (status: StatusDeUsuario | null) => {
      const anterior = estados;
      setErro(null);
      setSalvando(true);

      // a cor e a inicial saem do perfil da SESSÃO, não de um palpite: num
      // filme que ninguém marcou ainda não há estado anterior de onde tirá-las
      const eu = (status: StatusDeUsuario, desde: string): EstadoDeUsuario => ({
        userId: perfilId,
        inicial: perfil.inicial,
        acento: perfil.acento,
        status,
        desde,
      });

      setEstados(
        status === null
          ? anterior.filter((e) => e.userId !== perfilId)
          : [
              ...anterior.filter((e) => e.userId !== perfilId),
              eu(status, new Date().toISOString()),
            ],
      );

      try {
        const caminho = `/users/${perfilId}/titles/${titleId}/state`;

        if (status === null) {
          await api.delete(caminho);
          setEstados((atuais) => atuais.filter((e) => e.userId !== perfilId));
        } else {
          const salvo = await api.put<{ userId: string; status: StatusDeUsuario; desde: string }>(
            caminho,
            { status },
          );
          setEstados((atuais) => [
            ...atuais.filter((e) => e.userId !== perfilId),
            eu(salvo.status, salvo.desde),
          ]);
        }
      } catch (problema) {
        setEstados(anterior);
        setErro(problema instanceof Error ? problema.message : 'Não consegui salvar a marcação.');
      } finally {
        setSalvando(false);
      }
    },
    [estados, perfil, perfilId, titleId],
  );

  return { estados, meuStatus, salvando, erro, definir };
}
