import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';

/**
 * O "Sincronizar agora" do app (§9).
 *
 * `POST /sync/run` responde 202 na hora e deixa a sequência completa rodando
 * no servidor — leva minutos. Quem quer saber quando acabou consulta
 * `/health/sync`, e é isso que este hook faz até o fim.
 *
 * Como saber que acabou: a sequência termina sempre no job de notas
 * (`omdb_ratings`). Guardamos o início da última execução dele ANTES de
 * disparar; quando aparece uma execução nova e fechada, a sequência inteira
 * terminou. O relógio do celular não entra na conta — só o do servidor.
 *
 * Plano B: se o disparo morrer antes de abrir registro (já havia um sync
 * rodando, por exemplo), a execução nova nunca aparece. Três consultas
 * seguidas sem nada em andamento encerram a espera — o intervalo entre um job
 * e o próximo é de milissegundos, então três vazios seguidos não são pausa.
 */

interface Execucao {
  job: string;
  status: string;
  inicio: string;
}

interface SaudeResumida {
  execucoes: Execucao[];
}

export type EstadoDaSincronizacao = 'parado' | 'rodando' | 'concluido' | 'erro';

const ULTIMO_JOB = 'omdb_ratings';
const INTERVALO_MS = 4000;
const VAZIOS_PARA_DESISTIR = 3;
/** acima disso algo travou; melhor parar de perguntar e deixar a pessoa ver o estado */
const LIMITE_MS = 20 * 60_000;

export function useSincronizacao(aoTerminar?: () => void) {
  const [estado, setEstado] = useState<EstadoDaSincronizacao>('parado');
  const [erro, setErro] = useState<string | null>(null);

  const timer = useRef<number | null>(null);
  const montado = useRef(true);
  const aoTerminarRef = useRef(aoTerminar);
  aoTerminarRef.current = aoTerminar;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const sincronizar = useCallback(async () => {
    setEstado('rodando');
    setErro(null);

    try {
      const antes = await api.get<SaudeResumida>('/health/sync');
      const inicioAnterior = antes.execucoes.find((e) => e.job === ULTIMO_JOB)?.inicio ?? null;

      await api.post('/sync/run', {});

      const comeco = Date.now();
      let vazios = 0;

      const acompanhar = async () => {
        if (!montado.current) return;

        let terminou = false;
        try {
          const saude = await api.get<SaudeResumida>('/health/sync');
          const rodando = saude.execucoes.some((e) => e.status === 'running');
          const ultimo = saude.execucoes.find((e) => e.job === ULTIMO_JOB);
          const ultimoNovo = ultimo && ultimo.inicio !== inicioAnterior && ultimo.status !== 'running';

          vazios = rodando ? 0 : vazios + 1;
          terminou = Boolean(ultimoNovo) || vazios >= VAZIOS_PARA_DESISTIR;
        } catch {
          // uma consulta que falha no meio não é o sync que falhou; tenta de novo
        }

        if (!montado.current) return;

        if (terminou || Date.now() - comeco > LIMITE_MS) {
          setEstado('concluido');
          aoTerminarRef.current?.();
          return;
        }

        timer.current = window.setTimeout(() => void acompanhar(), INTERVALO_MS);
      };

      timer.current = window.setTimeout(() => void acompanhar(), INTERVALO_MS);
    } catch (problema) {
      if (!montado.current) return;
      setEstado('erro');
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui falar com o servidor.');
    }
  }, []);

  return { estado, erro, rodando: estado === 'rodando', sincronizar };
}
