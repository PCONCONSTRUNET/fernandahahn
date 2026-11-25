-- Garante que pagamentos parciais e quitações de pendências sejam registrados
-- no livro-caixa (caixa_movimentacoes) com identificação clara da parcela e observação.

CREATE OR REPLACE FUNCTION public.registrar_caixa_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  valor_anterior NUMERIC := 0;
  valor_atual NUMERIC := COALESCE(NEW.valor_pago, 0);
  delta NUMERIC;
  valor_total_servico NUMERIC := GREATEST(0, COALESCE(NEW.valor, 0) - COALESCE(NEW.valor_desconto_credito, 0));
  gorjeta_anterior NUMERIC := 0;
  gorjeta_atual NUMERIC := COALESCE(NEW.valor_gorjeta, 0);
  delta_gorjeta NUMERIC;
  momento TIMESTAMP WITH TIME ZONE;
  data_financeira DATE;
  id_externo TEXT;
  servico_nome TEXT := COALESCE(NULLIF(NEW.servico, ''), 'Atendimento');
  descricao_mov TEXT;
  ref_data_label TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    valor_anterior := COALESCE(OLD.valor_pago, 0);
    gorjeta_anterior := COALESCE(OLD.valor_gorjeta, 0);
  END IF;

  delta := valor_atual - valor_anterior;
  delta_gorjeta := gorjeta_atual - gorjeta_anterior;

  IF TG_OP = 'INSERT' THEN
    momento := COALESCE(NEW.paid_at, NEW.created_at, now());
  ELSIF NEW.paid_at IS DISTINCT FROM OLD.paid_at AND NEW.paid_at IS NOT NULL THEN
    momento := NEW.paid_at;
  ELSE
    momento := now();
  END IF;
  data_financeira := (momento AT TIME ZONE 'America/Sao_Paulo')::date;

  IF delta <> 0 THEN
    id_externo := CASE
      WHEN delta > 0 AND NEW.payment_id IS NOT NULL THEN 'gateway:' || NEW.payment_id
      ELSE NULL
    END;

    ref_data_label := CASE
      WHEN NEW.data_agendamento IS NOT NULL AND NEW.data_agendamento <> data_financeira
        THEN ' (ref. ' || to_char(NEW.data_agendamento, 'DD/MM') || ')'
      ELSE ''
    END;

    IF delta < 0 THEN
      descricao_mov := 'Estorno · ' || servico_nome;
    ELSIF valor_atual < valor_total_servico - 0.01 THEN
      descricao_mov := CASE
        WHEN valor_anterior <= 0.01 THEN 'Sinal / Parcela · ' || servico_nome || ref_data_label
        ELSE 'Parcela · ' || servico_nome || ref_data_label
      END;
    ELSIF valor_anterior > 0.01 THEN
      descricao_mov := 'Quitação · ' || servico_nome || ref_data_label;
    ELSIF NEW.data_agendamento IS NOT NULL AND NEW.data_agendamento < data_financeira THEN
      descricao_mov := 'Quitação pendente · ' || servico_nome || ref_data_label;
    ELSE
      descricao_mov := servico_nome;
    END IF;

    INSERT INTO public.caixa_movimentacoes (
      referencia_tipo,
      referencia_id,
      tipo,
      valor,
      forma_pagamento,
      data_pagamento,
      ocorrido_em,
      origem,
      descricao,
      cliente_nome,
      contabiliza_comissao,
      inferido,
      external_id
    ) VALUES (
      'agendamento',
      NEW.id,
      CASE WHEN delta > 0 THEN 'entrada' ELSE 'estorno' END,
      delta,
      NEW.forma_pagamento,
      data_financeira,
      momento,
      COALESCE(NULLIF(NEW.origem, ''), CASE WHEN NEW.payment_id IS NOT NULL THEN 'gateway' ELSE 'agendamento' END),
      descricao_mov,
      NEW.cliente_nome,
      position('SEM_COMISSAO' in COALESCE(NEW.observacao, '')) = 0,
      false,
      id_externo
    )
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING;
  END IF;

  IF delta_gorjeta <> 0 THEN
    INSERT INTO public.caixa_movimentacoes (
      referencia_tipo,
      referencia_id,
      tipo,
      valor,
      forma_pagamento,
      data_pagamento,
      ocorrido_em,
      origem,
      descricao,
      cliente_nome,
      contabiliza_comissao,
      inferido
    ) VALUES (
      'agendamento',
      NEW.id,
      CASE WHEN delta_gorjeta > 0 THEN 'gorjeta' ELSE 'estorno' END,
      delta_gorjeta,
      NEW.forma_pagamento,
      data_financeira,
      momento,
      'gorjeta',
      'Gorjeta',
      NEW.cliente_nome,
      true,
      false
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Enriquece o movimento recém-criado no caixa com número da parcela e observação
-- vindos de pagamento_historico (sem duplicar lançamentos no livro-caixa).
CREATE OR REPLACE FUNCTION public.enriquecer_caixa_parcela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mov_id UUID;
  mov_data DATE;
  ag_rec RECORD;
  parcela_num INTEGER;
  obs_clean TEXT := NULLIF(btrim(COALESCE(NEW.observacao, '')), '');
  servico_nome TEXT;
  ref_data DATE;
  ref_label TEXT;
  nova_desc TEXT;
BEGIN
  IF NEW.acao = 'acrescimo' OR COALESCE(NEW.valor_delta, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id, servico, data_agendamento
    INTO ag_rec
    FROM public.agendamentos
   WHERE id = NEW.agendamento_id;

  servico_nome := COALESCE(NULLIF(ag_rec.servico, ''), 'Atendimento');
  ref_data := ag_rec.data_agendamento;

  SELECT COUNT(*)
    INTO parcela_num
    FROM public.pagamento_historico
   WHERE agendamento_id = NEW.agendamento_id
     AND acao <> 'acrescimo'
     AND valor_delta > 0
     AND created_at <= NEW.created_at;

  SELECT id, data_pagamento
    INTO mov_id, mov_data
    FROM public.caixa_movimentacoes
   WHERE referencia_tipo = 'agendamento'
     AND referencia_id = NEW.agendamento_id
     AND tipo = 'entrada'
     AND ABS(valor - NEW.valor_delta) < 0.02
     AND created_at >= now() - interval '2 minutes'
   ORDER BY created_at DESC
   LIMIT 1;

  IF mov_id IS NULL THEN
    RETURN NEW;
  END IF;

  ref_label := CASE
    WHEN ref_data IS NOT NULL AND mov_data IS NOT NULL AND ref_data <> mov_data
      THEN ' (ref. ' || to_char(ref_data, 'DD/MM') || ')'
    ELSE ''
  END;

  IF COALESCE(NEW.valor_novo, 0) < COALESCE(NEW.total, 0) - 0.01 THEN
    nova_desc := 'Parcela ' || GREATEST(parcela_num, 1) || ' · ' || servico_nome || ref_label;
  ELSIF COALESCE(NEW.valor_anterior, 0) > 0.01 THEN
    nova_desc := 'Quitação (Parcela ' || GREATEST(parcela_num, 1) || ') · ' || servico_nome || ref_label;
  ELSIF ref_data IS NOT NULL AND mov_data IS NOT NULL AND ref_data < mov_data THEN
    nova_desc := 'Quitação pendente · ' || servico_nome || ref_label;
  ELSE
    nova_desc := servico_nome;
  END IF;

  IF obs_clean IS NOT NULL THEN
    nova_desc := nova_desc || ' — ' || obs_clean;
  END IF;

  UPDATE public.caixa_movimentacoes
     SET descricao = nova_desc
   WHERE id = mov_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_caixa_parcela ON public.pagamento_historico;
CREATE TRIGGER trg_enriquecer_caixa_parcela
AFTER INSERT ON public.pagamento_historico
FOR EACH ROW
EXECUTE FUNCTION public.enriquecer_caixa_parcela();
