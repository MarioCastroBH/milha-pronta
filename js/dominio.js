// Regras de negócio puras: sem tela e sem banco de dados.
// Valores monetários sempre em centavos (inteiros) para evitar erro de ponto flutuante.

export function paraCentavos(valor) {
  return Math.round(Number(valor) * 100);
}

export function formatarReal(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mesmoDia(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Move a data para o próximo dia útil quando cai em sábado, domingo ou feriado.
export function ajustarDiaUtil(data, feriados = []) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  while (d.getDay() === 0 || d.getDay() === 6 || feriados.some((f) => mesmoDia(f, d))) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// Data de fechamento da fatura que recebe a compra.
// Regra inferida da fatura de dezembro/2026: compras ANTES do dia de fechamento
// entram na fatura que fecha no mês; a partir do dia de fechamento, entram na seguinte.
// Validar com mais um ciclo antes de confiar 100% nessa fronteira.
export function fechamentoDaCompra(dataCompra, diaFechamento) {
  const ano = dataCompra.getFullYear();
  const mes = dataCompra.getMonth();
  const dentroDoCiclo = dataCompra.getDate() < diaFechamento;
  return new Date(ano, dentroDoCiclo ? mes : mes + 1, diaFechamento);
}

// Vencimento: cai no mês seguinte ao fechamento, com ajuste para dia útil.
export function vencimentoDaFatura(fechamento, diaVencimento, feriados = []) {
  const bruto = new Date(fechamento.getFullYear(), fechamento.getMonth() + 1, diaVencimento);
  return ajustarDiaUtil(bruto, feriados);
}

export function formatarData(data) {
  return data.toLocaleDateString("pt-BR");
}
