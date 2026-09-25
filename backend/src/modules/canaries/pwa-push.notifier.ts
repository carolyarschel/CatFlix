import { logger } from '../../shared/logger';
import type { Aviso, Notifier } from './notifier';
import { enviarParaTodos, pushConfigurado } from './push.service';

const log = logger.child({ module: 'notifier:pwa' });

/**
 * Canal de alerta pelo PWA (§3, decisão de 22/09/2026).
 *
 * É o único canal que não depende de serviço de terceiro: o alerta vai direto
 * para o celular de quem instalou o app.
 *
 * ⚠️ **iOS:** o Safari só entrega Web Push se o PWA estiver INSTALADO na tela
 * de início (16.4+). Aberto pelo navegador, não há inscrição e nada chega.
 * Enquanto não houver dispositivo inscrito, este canal não falha — ele
 * simplesmente não tem para onde mandar, e o LogNotifier segue sendo o piso.
 */
export class PwaPushNotifier implements Notifier {
  readonly nome = 'pwa-push';

  async enviar(aviso: Aviso): Promise<string[]> {
    if (!pushConfigurado()) {
      log.debug('sem chaves VAPID; push desligado');
      return [];
    }

    const r = await enviarParaTodos({
      title: aviso.severity === 'critical' ? `⚠️ ${aviso.titulo}` : aviso.titulo,
      body: aviso.mensagem,
      // a `tag` faz o navegador SUBSTITUIR a notificação anterior do mesmo
      // problema em vez de empilhar — o equivalente, na tela, da regra do §8
      // de não reenviar o mesmo alerta
      tag: aviso.fingerprint,
      url: '/health',
      data: { fingerprint: aviso.fingerprint, severity: aviso.severity },
    });

    if (r.semInscricao) {
      // Não é falha: até o PWA existir e alguém aceitar a permissão, não há
      // para onde mandar. Lista vazia — não entregou, mas não quebrou.
      log.debug('nenhum dispositivo inscrito ainda', { fingerprint: aviso.fingerprint });
      return [];
    }

    log.info('alerta enviado por push', {
      fingerprint: aviso.fingerprint,
      enviados: r.enviados,
      expirados: r.expirados,
      falhas: r.falhas,
    });

    // se NENHUM dispositivo recebeu, isto é falha de canal
    if (r.enviados === 0 && r.falhas > 0) {
      throw new Error(`push não chegou a nenhum dispositivo (${r.falhas} falha(s))`);
    }

    return r.enviados > 0 ? [this.nome] : [];
  }
}
