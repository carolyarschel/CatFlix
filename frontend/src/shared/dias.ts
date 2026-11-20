/**
 * "Hoje", "Amanhã" ou "Sáb, 27 set". O dia vem como `AAAA-MM-DD` no fuso da
 * CIDADE e é comparado com o hoje do aparelho montando as duas datas do mesmo
 * jeito — `new Date('2026-09-24')` seria meia-noite UTC, o dia anterior no
 * Brasil.
 */
export function formatarDia(dia: string): string {
  const [ano, mes, data] = dia.split('-').map(Number);
  if (!ano || !mes || !data) return dia;

  const alvo = new Date(ano, mes - 1, data);
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Amanhã';

  return alvo
    .toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.,', ',')
    .replace(/\.$/, '');
}
