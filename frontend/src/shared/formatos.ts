/**
 * Formatação de apresentação usada em mais de uma tela.
 *
 * Só o que não depende de fuso: horário e dia de sessão chegam prontos do
 * backend, que é quem sabe o fuso da cidade.
 */

/** "2h18" — minuto puro ("138 min") obriga a pessoa a fazer a conta. */
export function formatarDuracao(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
}

/** "3 horas", "2 dias" — o aviso do modo degradado (§8) não precisa de precisão decimal. */
export function formatarIdade(horas: number | null): string {
  if (horas === null) return 'um tempo';
  if (horas < 1) return 'menos de uma hora';
  if (horas < 24) {
    const inteiras = Math.round(horas);
    return inteiras === 1 ? '1 hora' : `${inteiras} horas`;
  }

  const dias = Math.round(horas / 24);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}
