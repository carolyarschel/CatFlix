import type { AlertSeverity } from '@prisma/client';
import { env } from '../../config/env';
import { HttpClient } from '../../shared/http';
import { logger } from '../../shared/logger';
import { PwaPushNotifier } from './pwa-push.notifier';

const log = logger.child({ module: 'notifier' });

export interface Aviso {
  severity: AlertSeverity;
  titulo: string;
  mensagem: string;
  /** chave de deduplicação; o mesmo fingerprint não é reenviado (§8) */
  fingerprint: string;
  detalhes?: Record<string, unknown>;
}

/**
 * Canal de alerta (§8).
 *
 * A interface existe para o canal poder mudar sem mexer em canary nenhum. Hoje
 * o canal escolhido é o PWA (§3).
 *
 * ⚠️ `enviar` devolve **os canais que entregaram de fato**, não `void`. Isso
 * não é detalhe: com um composto que engole a falha de um canal para não
 * derrubar os outros, um `void` faria o alerta ser marcado como "enviado"
 * quando só o log funcionou — e a Carol leria "enviado: sim" achando que a
 * notificação chegou no celular dela.
 */
export interface Notifier {
  readonly nome: string;
  enviar(aviso: Aviso): Promise<string[]>;
}

/** Sempre ligado. É o piso: um alerta nunca se perde por falta de canal. */
export class LogNotifier implements Notifier {
  readonly nome = 'log';

  async enviar(aviso: Aviso): Promise<string[]> {
    const nivel = aviso.severity === 'critical' ? 'error' : aviso.severity === 'warning' ? 'warn' : 'info';
    log[nivel](`[${aviso.severity}] ${aviso.titulo}`, {
      mensagem: aviso.mensagem,
      fingerprint: aviso.fingerprint,
      ...aviso.detalhes,
    });
    return [this.nome];
  }
}

/**
 * Webhook genérico: `POST` com um JSON simples.
 *
 * O formato é deliberadamente neutro. Discord e Slack esperam `content` e
 * `text` respectivamente, então mandamos os dois além dos campos estruturados
 * — assim o webhook funciona nos dois sem adaptador, e um serviço próprio lê
 * os campos que preferir.
 *
 * ⚠️ Qual serviço a Carol vai usar ainda está [EM ABERTO] (§3). Se for um que
 * exija outro formato, o ajuste é só aqui.
 */
export class WebhookNotifier implements Notifier {
  readonly nome = 'webhook';
  private readonly http: HttpClient;

  constructor(private readonly url: string) {
    this.http = new HttpClient({
      source: 'notifier',
      baseUrl: url,
      maxConcurrency: 1,
      // alerta atrasado ainda serve; alerta que trava o job, não
      timeoutMs: 8_000,
      maxRetries: 1,
    });
  }

  async enviar(aviso: Aviso): Promise<string[]> {
    const linha = `[${aviso.severity.toUpperCase()}] ${aviso.titulo} — ${aviso.mensagem}`;

    const resposta = await this.http.request('', {
      method: 'POST',
      body: {
        content: linha, // Discord
        text: linha, // Slack
        severity: aviso.severity,
        titulo: aviso.titulo,
        mensagem: aviso.mensagem,
        fingerprint: aviso.fingerprint,
        detalhes: aviso.detalhes ?? {},
        app: 'filmes',
        em: new Date().toISOString(),
      },
    });

    if (!resposta.ok) {
      throw new Error(`webhook respondeu ${resposta.status}`);
    }

    return [this.nome];
  }
}

/**
 * Manda para todos os canais configurados.
 *
 * Um canal que falha **não** impede os outros, e nunca derruba o job que
 * disparou o alerta: se o push está fora, o problema original continua
 * registrado no banco e no log.
 *
 * Devolve só quem ENTREGOU — é o que permite ao `/health/sync` dizer
 * "avisado por: log" em vez de mentir "enviado".
 */
export class NotifierComposto implements Notifier {
  readonly nome: string;

  constructor(private readonly canais: Notifier[]) {
    this.nome = canais.map((c) => c.nome).join('+');
  }

  async enviar(aviso: Aviso): Promise<string[]> {
    const resultados = await Promise.allSettled(this.canais.map((c) => c.enviar(aviso)));
    const entregues: string[] = [];

    resultados.forEach((r, i) => {
      if (r.status === 'rejected') {
        log.error('canal de alerta falhou', { canal: this.canais[i]!.nome, erro: r.reason });
        return;
      }
      entregues.push(...r.value);
    });

    return entregues;
  }
}

let padrao: Notifier | null = null;

/**
 * Os canais ligados, em ordem de importância:
 *
 *   log        sempre — é o piso, um alerta nunca se perde por falta de canal
 *   pwa-push   quando há chaves VAPID: o canal escolhido pela Carol (§3)
 *   webhook    quando há URL: sobra da decisão anterior, sem uso hoje
 */
export function notifierPadrao(): Notifier {
  if (padrao) return padrao;

  const canais: Notifier[] = [new LogNotifier()];

  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) canais.push(new PwaPushNotifier());
  if (env.NOTIFIER_WEBHOOK_URL) canais.push(new WebhookNotifier(env.NOTIFIER_WEBHOOK_URL));

  padrao = new NotifierComposto(canais);
  return padrao;
}

/** Para teste. */
export function definirNotifier(notifier: Notifier | null): void {
  padrao = notifier;
}
