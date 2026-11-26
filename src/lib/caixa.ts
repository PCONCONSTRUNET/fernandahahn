import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

export interface CaixaMovimentacao {
  id: string;
  referencia_tipo: "agendamento" | "venda";
  referencia_id: string;
  tipo: "entrada" | "estorno" | "gorjeta";
  valor: number;
  forma_pagamento?: string | null;
  data_pagamento: string;
  ocorrido_em: string;
  origem: string;
  descricao?: string | null;
  cliente_nome?: string | null;
  contabiliza_comissao: boolean;
  inferido: boolean;
  observacao?: string | null;
  parcela_numero?: number | null;
  valor_total_servico?: number | null;
  valor_pago_acumulado?: number | null;
  valor_restante?: number | null;
  data_atendimento?: string | null;
}

export interface LocalPagamentoHistorico {
  id: string;
  agendamento_id: string;
  status_anterior: string;
  status_novo: string;
  valor_anterior: number;
  valor_novo: number;
  valor_delta: number;
  total: number;
  acao: string;
  autor_id?: string | null;
  autor_nome: string;
  observacao?: string;
  created_at: string;
}

export const CAIXA_MOVIMENTACOES_PREVIEW_KEY = "studio_caixa_movimentacoes_preview";
export const CAIXA_RETIRADAS_PREVIEW_KEY = "studio_caixa_retiradas_preview";
export const PAGAMENTOS_HIST_PREVIEW_KEY = "studio_pagamento_historico_preview";
export const CAIXA_UPDATED_EVENT = "studio:caixa-updated";

export const toLocalDateISO = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const formatBRLCompact = (val: number): string =>
  Number(val || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDayMonthBR = (iso?: string | null): string => {
  if (!iso || iso.length < 10) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

export interface InstallmentDescriptionParams {
  servico?: string | null;
  variacao?: string | null;
  valorPagoAntes: number;
  valorParcela: number;
  valorTotal: number;
  parcelaNumero?: number;
  observacao?: string | null;
  dataAtendimento?: string | null;
  dataPagamento?: string | null;
}

/**
 * Monta identificação clara da parcela ou quitação no livro-caixa.
 */
export const formatInstallmentDescription = ({
  servico,
  variacao,
  valorPagoAntes,
  valorParcela,
  valorTotal,
  parcelaNumero,
  observacao,
  dataAtendimento,
  dataPagamento,
}: InstallmentDescriptionParams): string => {
  const svcBase = servico?.trim() || "Atendimento";
  const svc = variacao?.trim() ? `${svcBase} (${variacao.trim()})` : svcBase;
  const valorAcumulado = valorPagoAntes + valorParcela;
  const restante = Math.max(0, valorTotal - valorAcumulado);
  const obs = observacao?.trim() || "";
  const refTag =
    dataAtendimento && dataPagamento && dataAtendimento !== dataPagamento
      ? ` (ref. ${formatDayMonthBR(dataAtendimento)})`
      : "";

  let title = svc;
  if (restante > 0.01) {
    const label =
      parcelaNumero && parcelaNumero > 0
        ? `Parcela ${parcelaNumero}`
        : valorPagoAntes <= 0.01
          ? "Sinal / Parcela"
          : "Parcela";
    title = `${label} · ${svc}${refTag}`;
  } else if (valorPagoAntes > 0.01) {
    const numTag = parcelaNumero && parcelaNumero > 1 ? ` (Parcela ${parcelaNumero})` : "";
    title = `Quitação${numTag} · ${svc}${refTag}`;
  } else if (dataAtendimento && dataPagamento && dataAtendimento < dataPagamento) {
    title = `Quitação pendente · ${svc}${refTag}`;
  }

  return obs ? `${title} — ${obs}` : title;
};

export interface InstallmentBadgeInfo {
  kind: "parcela" | "quitacao" | "estorno" | "normal";
  badgeLabel: string | null;
  progressText: string | null;
  refDateText: string | null;
  observacaoText: string | null;
}

/**
 * Extrai identificação estruturada de uma entrada do livro-caixa para exibição no Extrato e Resumo do Dia.
 */
export const classifyInstallmentMovement = (
  m: Pick<
    CaixaMovimentacao,
    | "tipo"
    | "valor"
    | "descricao"
    | "data_pagamento"
    | "observacao"
    | "parcela_numero"
    | "valor_total_servico"
    | "valor_pago_acumulado"
    | "valor_restante"
    | "data_atendimento"
  >,
  linked?: {
    valor?: number | null;
    valor_pago?: number | null;
    valor_desconto_credito?: number | null;
    data_agendamento?: string | null;
  } | null,
  matchedHist?: {
    parcelaNumero?: number;
    observacao?: string | null;
    valorNovo?: number;
    total?: number;
  } | null,
): InstallmentBadgeInfo => {
  if (Number(m.valor) < 0 || m.tipo === "estorno") {
    return {
      kind: "estorno",
      badgeLabel: "Estorno",
      progressText: null,
      refDateText: null,
      observacaoText: m.observacao?.trim() || null,
    };
  }

  const desc = m.descricao || "";
  const totalServico = Math.max(
    0,
    Number(
      m.valor_total_servico ??
        matchedHist?.total ??
        (linked ? Number(linked.valor || 0) - Number(linked.valor_desconto_credito || 0) : 0),
    ),
  );
  const pagoAcumulado = Number(m.valor_pago_acumulado ?? matchedHist?.valorNovo ?? linked?.valor_pago ?? 0);
  const restante =
    m.valor_restante != null
      ? Math.max(0, Number(m.valor_restante))
      : totalServico > 0
        ? Math.max(0, totalServico - pagoAcumulado)
        : 0;

  const parcelaNum = m.parcela_numero ?? matchedHist?.parcelaNumero ?? null;
  const obsRaw = (m.observacao || matchedHist?.observacao || "").trim();
  const dataAtend = m.data_atendimento || linked?.data_agendamento || null;
  const isCrossDay = Boolean(dataAtend && m.data_pagamento && dataAtend !== m.data_pagamento);
  const refDateText = isCrossDay ? `Atend. ${formatDayMonthBR(dataAtend)}` : null;

  const isPartialDesc = /^(Parcela|Sinal \/ Parcela)/i.test(desc);
  const isSettleDesc = /^Quitação/i.test(desc);
  const isPartialValue =
    totalServico > 0 &&
    (Number(m.valor) < totalServico - 0.01 || restante > 0.01) &&
    !isSettleDesc;

  if (isPartialDesc || (isPartialValue && restante > 0.01)) {
    const badgeLabel = parcelaNum && parcelaNum > 0 ? `Parcela ${parcelaNum}` : "Parcela";
    const progressText =
      totalServico > 0
        ? restante > 0.01
          ? `${formatBRLCompact(m.valor)} de ${formatBRLCompact(totalServico)} · falta ${formatBRLCompact(restante)}`
          : `${formatBRLCompact(m.valor)} de ${formatBRLCompact(totalServico)} · quitado`
        : null;
    return {
      kind: "parcela",
      badgeLabel,
      progressText,
      refDateText,
      observacaoText: obsRaw || null,
    };
  }

  if (isSettleDesc || (totalServico > 0 && Number(m.valor) < totalServico - 0.01 && restante <= 0.01) || (dataAtend && m.data_pagamento && dataAtend < m.data_pagamento)) {
    const badgeLabel =
      parcelaNum && parcelaNum > 1
        ? `Quitação (${parcelaNum}ª parc.)`
        : isSettleDesc || (totalServico > 0 && Number(m.valor) < totalServico - 0.01)
          ? "Quitação pendente"
          : "Baixa de pendência";
    const progressText =
      totalServico > 0 ? `Quitado (${formatBRLCompact(totalServico)})` : null;
    return {
      kind: "quitacao",
      badgeLabel,
      progressText,
      refDateText,
      observacaoText: obsRaw || null,
    };
  }

  return {
    kind: "normal",
    badgeLabel: null,
    progressText: null,
    refDateText: null,
    observacaoText: obsRaw || null,
  };
};

const readLocalList = <T,>(key: string): T[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalList = <T,>(key: string, items: T[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (err) {
    console.warn(`[localStorage] falha ao salvar ${key}:`, err);
  }
};

export const notifyCaixaUpdated = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CAIXA_UPDATED_EVENT));
  }
};

export const getLocalCaixaMovimentacoes = (): CaixaMovimentacao[] =>
  readLocalList<CaixaMovimentacao>(CAIXA_MOVIMENTACOES_PREVIEW_KEY);

export const recordLocalCaixaMovimentacao = (
  entry: Omit<CaixaMovimentacao, "id" | "ocorrido_em"> & { id?: string; ocorrido_em?: string },
): CaixaMovimentacao => {
  const newItem: CaixaMovimentacao = {
    ...entry,
    id: entry.id || crypto.randomUUID?.() || `mov-${Date.now()}-${Math.random()}`,
    ocorrido_em: entry.ocorrido_em || new Date().toISOString(),
  };
  const current = getLocalCaixaMovimentacoes();
  writeLocalList(CAIXA_MOVIMENTACOES_PREVIEW_KEY, [newItem, ...current]);
  notifyCaixaUpdated();
  return newItem;
};

export const getLocalPagamentoHistorico = (): LocalPagamentoHistorico[] =>
  readLocalList<LocalPagamentoHistorico>(PAGAMENTOS_HIST_PREVIEW_KEY);

export const recordLocalPagamentoHistorico = (
  entry: Omit<LocalPagamentoHistorico, "id" | "created_at"> & { id?: string; created_at?: string },
): LocalPagamentoHistorico => {
  const newItem: LocalPagamentoHistorico = {
    ...entry,
    id: entry.id || crypto.randomUUID?.() || `hist-${Date.now()}-${Math.random()}`,
    created_at: entry.created_at || new Date().toISOString(),
  };
  const current = getLocalPagamentoHistorico();
  writeLocalList(PAGAMENTOS_HIST_PREVIEW_KEY, [newItem, ...current]);
  return newItem;
};

export const deleteLocalPagamentoHistorico = (histId: string) => {
  const current = getLocalPagamentoHistorico();
  writeLocalList(
    PAGAMENTOS_HIST_PREVIEW_KEY,
    current.filter((h) => h.id !== histId),
  );
};

export const deleteLocalCaixaMovimentacao = (movId: string) => {
  const current = getLocalCaixaMovimentacoes();
  writeLocalList(
    CAIXA_MOVIMENTACOES_PREVIEW_KEY,
    current.filter((m) => m.id !== movId),
  );
  notifyCaixaUpdated();
};

export const getLocalRetiradasPreview = <T = any>(): T[] =>
  readLocalList<T>(CAIXA_RETIRADAS_PREVIEW_KEY);

export const saveLocalRetiradasPreview = <T = any>(items: T[]) => {
  writeLocalList(CAIXA_RETIRADAS_PREVIEW_KEY, items);
};

export interface PersistPaymentInput {
  agendamento: {
    id: string;
    servico?: string | null;
    variacao?: string | null;
    valor: number;
    valor_pago?: number | null;
    valor_desconto_credito?: number | null;
    data_agendamento: string;
    forma_pagamento?: string | null;
    cliente_nome?: string | null;
    status?: string;
    observacao?: string | null;
  };
  valorAdicional: number;
  formaPagamento: string;
  observacao?: string;
  novoValorServico?: number;
  markConcluidoOnSettle?: boolean;
  origem?: string;
}

export interface PersistPaymentResult {
  novoValorPago: number;
  novoValorTotal: number;
  quitada: boolean;
  restante: number;
  parcelaNumero: number;
  statusNovo: string;
  paidAt: string;
  movimentacaoLocal?: CaixaMovimentacao;
}

const statusFromValor = (pago: number, total: number): "nao_pago" | "quitado_parcial" | "quitado" => {
  if (pago <= 0) return "nao_pago";
  if (pago >= total - 0.01) return "quitado";
  return "quitado_parcial";
};

/**
 * Registra pagamento (parcial ou integral) no agendamento, grava auditoria em pagamento_historico
 * e garante lançamento identificado no Caixa (via trigger no Supabase ou preview local offline).
 */
export const persistAppointmentPayment = async ({
  agendamento,
  valorAdicional,
  formaPagamento,
  observacao = "",
  novoValorServico,
  markConcluidoOnSettle = false,
  origem = "pagamento_parcial",
}: PersistPaymentInput): Promise<PersistPaymentResult> => {
  const valorAntes = Number(agendamento.valor_pago || 0);
  const descontoCredito = Number(agendamento.valor_desconto_credito || 0);
  const valorServicoFinal =
    novoValorServico != null ? Number(novoValorServico) : Number(agendamento.valor || 0);
  const novoValorPago = Math.min(valorServicoFinal, valorAntes + Number(valorAdicional || 0));
  const valorLiquidoDevido = Math.max(0, valorServicoFinal - descontoCredito);
  const quitada = novoValorPago >= valorLiquidoDevido - 0.01;
  const restante = Math.max(0, valorLiquidoDevido - novoValorPago);
  const statusAnterior = statusFromValor(valorAntes, valorServicoFinal);
  const statusNovo = statusFromValor(novoValorPago, valorServicoFinal);
  const acao = quitada ? "quitar" : "registro";
  const paidAt = new Date().toISOString();
  const dataPagamento = toLocalDateISO(new Date());
  const obsClean = observacao.trim();

  if (!isSupabaseConfigured) {
    const prevCount = getLocalPagamentoHistorico().filter(
      (h) => h.agendamento_id === agendamento.id && h.acao !== "acrescimo" && h.valor_delta > 0,
    ).length;
    const parcelaNumero = prevCount + 1;

    recordLocalPagamentoHistorico({
      agendamento_id: agendamento.id,
      status_anterior: statusAnterior,
      status_novo: statusNovo,
      valor_anterior: valorAntes,
      valor_novo: novoValorPago,
      valor_delta: valorAdicional,
      total: valorServicoFinal,
      acao,
      autor_id: null,
      autor_nome: "Admin",
      observacao: obsClean,
    });

    const descricao = formatInstallmentDescription({
      servico: agendamento.servico,
      variacao: agendamento.variacao,
      valorPagoAntes: valorAntes,
      valorParcela: valorAdicional,
      valorTotal: valorLiquidoDevido,
      parcelaNumero,
      observacao: obsClean,
      dataAtendimento: agendamento.data_agendamento,
      dataPagamento,
    });

    const movimentacaoLocal = recordLocalCaixaMovimentacao({
      referencia_tipo: "agendamento",
      referencia_id: agendamento.id,
      tipo: "entrada",
      valor: valorAdicional,
      forma_pagamento: formaPagamento,
      data_pagamento: dataPagamento,
      ocorrido_em: paidAt,
      origem,
      descricao,
      cliente_nome: agendamento.cliente_nome || "Presencial",
      contabiliza_comissao: !(agendamento.observacao || "").includes("SEM_COMISSAO"),
      inferido: false,
      observacao: obsClean || null,
      parcela_numero: parcelaNumero,
      valor_total_servico: valorLiquidoDevido,
      valor_pago_acumulado: novoValorPago,
      valor_restante: restante,
      data_atendimento: agendamento.data_agendamento,
    });

    return {
      novoValorPago,
      novoValorTotal: valorServicoFinal,
      quitada,
      restante,
      parcelaNumero,
      statusNovo,
      paidAt,
      movimentacaoLocal,
    };
  }

  let autorId: string | null = null;
  let autorNome = "Admin";
  try {
    const { data: userRes } = await supabase.auth.getUser();
    autorId = userRes?.user?.id || null;
    autorNome =
      (userRes?.user?.user_metadata as any)?.nome ||
      userRes?.user?.email ||
      "Admin";
  } catch {
    // segue com fallback Admin
  }

  const updatePayload: Record<string, any> = {
    valor_pago: novoValorPago,
    forma_pagamento: formaPagamento,
    paid_at: paidAt,
  };
  if (valorServicoFinal > Number(agendamento.valor || 0)) {
    updatePayload.valor = valorServicoFinal;
  }
  if (markConcluidoOnSettle && quitada) {
    updatePayload.status = "concluido";
  }

  const { error: errUpdate } = await supabase
    .from("agendamentos")
    .update(updatePayload)
    .eq("id", agendamento.id);
  if (errUpdate) throw errUpdate;

  const { error: errHist } = await supabase.from("pagamento_historico").insert({
    agendamento_id: agendamento.id,
    status_anterior: statusAnterior,
    status_novo: statusNovo,
    valor_anterior: valorAntes,
    valor_novo: novoValorPago,
    valor_delta: valorAdicional,
    total: valorServicoFinal,
    acao,
    autor_id: autorId,
    autor_nome: autorNome,
    observacao: obsClean,
  });
  if (errHist) {
    console.warn("[pagamento_historico] falha ao registrar parcela:", errHist.message);
  }

  notifyCaixaUpdated();

  return {
    novoValorPago,
    novoValorTotal: valorServicoFinal,
    quitada,
    restante,
    parcelaNumero: 1,
    statusNovo,
    paidAt,
  };
};

export interface AgendamentoCaixa {
  id: string;
  data_agendamento: string;
  status: string;
  servico?: string | null;
  valor: number;
  valor_pago?: number | null;
  valor_gorjeta?: number | null;
  valor_desconto_credito?: number | null;
}

export const isLancamentoOperacional = (servico?: string | null) =>
  servico !== "Adição de Crédito" &&
  servico !== "Entrada Manual" &&
  !servico?.startsWith("Pagamento de Dívida");

export const normalizePaymentMethod = (forma?: string | null) => {
  const value = (forma || "").toLowerCase().trim();
  if (value.includes("pix")) return "pix";
  if (
    value.includes("cart") ||
    value.includes("credito") ||
    value.includes("crédito") ||
    value.includes("debito") ||
    value.includes("débito")
  ) return "cartao";
  if (
    value.includes("dinheiro") ||
    value.includes("especie") ||
    value.includes("espécie") ||
    value.includes("cash")
  ) return "dinheiro";
  return "outro";
};

export const calculateDailyClosing = (
  allAppointments: AgendamentoCaixa[],
  movements: CaixaMovimentacao[],
  selectedDate: string,
) => {
  const items = allAppointments.filter(
    (appointment) =>
      appointment.data_agendamento === selectedDate && appointment.status !== "cancelado",
  );
  const serviceItems = items.filter((appointment) => isLancamentoOperacional(appointment.servico));
  const dayMovements = movements.filter((movement) => movement.data_pagamento === selectedDate);
  const appointmentIds = new Set(serviceItems.map((appointment) => appointment.id));

  const total = serviceItems.reduce(
    (sum, appointment) =>
      sum +
      Math.max(0, Number(appointment.valor) - Number(appointment.valor_desconto_credito || 0)) +
      Number(appointment.valor_gorjeta || 0),
    0,
  );
  const recebido = dayMovements.reduce((sum, movement) => sum + Number(movement.valor), 0);
  const recebidoHojeDosAtendimentos = dayMovements
    .filter(
      (movement) =>
        movement.referencia_tipo === "agendamento" && appointmentIds.has(movement.referencia_id),
    )
    .reduce((sum, movement) => sum + Number(movement.valor), 0);
  const pagoNosAtendimentos = serviceItems.reduce(
    (sum, appointment) =>
      sum + Number(appointment.valor_pago || 0) + Number(appointment.valor_gorjeta || 0),
    0,
  );
  const recebidoAnteriormente = Math.max(0, pagoNosAtendimentos - recebidoHojeDosAtendimentos);
  const pagoComCredito = serviceItems.reduce(
    (sum, appointment) => sum + Number(appointment.valor_desconto_credito || 0),
    0,
  );
  const pendente = serviceItems.reduce(
    (sum, appointment) =>
      sum +
      Math.max(
        0,
        Number(appointment.valor) -
          Number(appointment.valor_pago || 0) -
          Number(appointment.valor_desconto_credito || 0),
      ),
    0,
  );
  const faltas = allAppointments.filter(
    (appointment) =>
      appointment.data_agendamento === selectedDate && appointment.status === "falta",
  ).length;
  const valorJaPagoDosAtendimentos = pagoNosAtendimentos + pagoComCredito;
  const progressPercent = total > 0
    ? Math.round((valorJaPagoDosAtendimentos / total) * 100)
    : valorJaPagoDosAtendimentos > 0 ? 100 : 0;

  return {
    items: serviceItems,
    pagamentos: dayMovements,
    total,
    recebido,
    recebidoAnteriormente,
    recebidoHojeDosAtendimentos,
    pagoComCredito,
    pendente,
    qtd: serviceItems.length,
    faltas,
    progressPercent,
  };
};

export interface CommissionHistoryEntry {
  startDate: string; // ISO date YYYY-MM-DD
  rate: number;      // 0 to 100
}

export const getCommissionRateForDate = (
  dateStr: string,
  history: CommissionHistoryEntry[],
  currentRate: number,
): number => {
  if (!history || history.length === 0) return currentRate;
  // Ordena por data decrescente para pegar a taxa que vigora a partir de cada data
  const sorted = [...history].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const entry = sorted.find((e) => (dateStr || "") >= e.startDate);
  return entry !== undefined ? entry.rate : (sorted[sorted.length - 1]?.rate ?? currentRate);
};

export const getCommissionHistory = (currentRate: number): CommissionHistoryEntry[] => {
  try {
    const raw = localStorage.getItem("studio_comissao_history");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Erro ao ler studio_comissao_history:", e);
  }
  return [{ startDate: "0000-01-01", rate: currentRate }];
};

export const saveNewCommissionRate = (
  newRate: number,
  effectiveDate: string,
  currentHistory: CommissionHistoryEntry[],
): CommissionHistoryEntry[] => {
  const filtered = currentHistory.filter((e) => e.startDate !== effectiveDate);
  const updated = [...filtered, { startDate: effectiveDate, rate: newRate }].sort(
    (a, b) => a.startDate.localeCompare(b.startDate),
  );
  localStorage.setItem("studio_comissao_history", JSON.stringify(updated));
  localStorage.setItem("studio_comissao_pct", String(newRate));
  return updated;
};

export const calculateCommission = (
  movements: CaixaMovimentacao[],
  commissionPercent: number,
  history?: CommissionHistoryEntry[],
) => {
  const tips = movements
    .filter((movement) => movement.tipo === "gorjeta")
    .reduce((sum, movement) => sum + Number(movement.valor), 0);
  const base = movements
    .filter((movement) => movement.tipo !== "gorjeta" && movement.contabiliza_comissao)
    .reduce((sum, movement) => sum + Number(movement.valor), 0);

  let totalCommission = 0;
  if (!history || history.length === 0) {
    totalCommission = base * (commissionPercent / 100);
  } else {
    totalCommission = movements
      .filter((m) => m.tipo !== "gorjeta" && m.contabiliza_comissao)
      .reduce((acc, m) => {
        const rate = getCommissionRateForDate(m.data_pagamento, history, commissionPercent);
        return acc + Number(m.valor) * (rate / 100);
      }, 0);
  }

  return { base, tips, total: totalCommission + tips };
};

export const sumMovementsForPeriod = (
  movements: CaixaMovimentacao[],
  startDate: string,
  endDate: string,
) => movements
  .filter(
    (movement) =>
      movement.data_pagamento >= startDate && movement.data_pagamento <= endDate,
  )
  .reduce((sum, movement) => sum + Number(movement.valor), 0);
