-- Permite excluir lançamentos do livro-caixa (caixa_movimentacoes) com sincronização
-- limpa do agendamento / histórico / venda de origem sem gerar estorno fantasma.

DROP POLICY IF EXISTS "Excluir movimentações do caixa" ON public.caixa_movimentacoes;
CREATE POLICY "Excluir movimentações do caixa"
  ON public.caixa_movimentacoes FOR DELETE
  TO anon, authenticated
  USING (true);

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
  IF current_setting('app.skip_caixa_trigger', true) = 'true' THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION public.registrar_caixa_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  valor_anterior NUMERIC := 0;
  valor_atual NUMERIC;
  delta NUMERIC;
  momento TIMESTAMP WITH TIME ZONE;
BEGIN
  IF current_setting('app.skip_caixa_trigger', true) = 'true' THEN
    RETURN NEW;
  END IF;

  valor_atual := CASE
    WHEN NEW.pago THEN COALESCE(NULLIF(NEW.valor_pago, 0), NEW.valor_total, 0)
    ELSE COALESCE(NEW.valor_pago, 0)
  END;

  IF TG_OP = 'UPDATE' THEN
    valor_anterior := CASE
      WHEN OLD.pago THEN COALESCE(NULLIF(OLD.valor_pago, 0), OLD.valor_total, 0)
      ELSE COALESCE(OLD.valor_pago, 0)
    END;
  END IF;

  delta := valor_atual - valor_anterior;
  IF delta = 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    momento := COALESCE(
      NEW.paid_at,
      (NEW.data_venda::timestamp + time '12:00') AT TIME ZONE 'America/Sao_Paulo',
      NEW.created_at,
      now()
    );
  ELSIF NEW.paid_at IS DISTINCT FROM OLD.paid_at AND NEW.paid_at IS NOT NULL THEN
    momento := NEW.paid_at;
  ELSE
    momento := now();
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
    inferido
  ) VALUES (
    'venda',
    NEW.id,
    CASE WHEN delta > 0 THEN 'entrada' ELSE 'estorno' END,
    delta,
    NEW.forma_pagamento,
    (momento AT TIME ZONE 'America/Sao_Paulo')::date,
    momento,
    'venda',
    'Venda de Produtos',
    NEW.cliente_nome,
    true,
    false
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_lancamento_caixa(p_movimento_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mov RECORD;
  v_ag RECORD;
  v_hist_id UUID;
  v_novo_pago NUMERIC;
  v_novo_gorjeta NUMERIC;
  v_novo_status TEXT;
BEGIN
  SELECT * INTO mov
    FROM public.caixa_movimentacoes
   WHERE id = p_movimento_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  DELETE FROM public.caixa_movimentacoes WHERE id = p_movimento_id;

  PERFORM set_config('app.skip_caixa_trigger', 'true', true);

  IF mov.referencia_tipo = 'agendamento' THEN
    SELECT id, servico, origem, valor, valor_pago, valor_gorjeta, valor_desconto_credito, status, paid_at
      INTO v_ag
      FROM public.agendamentos
     WHERE id = mov.referencia_id;

    IF FOUND THEN
      IF v_ag.origem = 'manual' OR v_ag.servico = 'Entrada Manual' THEN
        DELETE FROM public.pagamento_historico WHERE agendamento_id = v_ag.id;
        DELETE FROM public.agendamentos WHERE id = v_ag.id;
      ELSIF mov.tipo = 'gorjeta' AND COALESCE(mov.valor, 0) > 0 THEN
        v_novo_gorjeta := GREATEST(0, COALESCE(v_ag.valor_gorjeta, 0) - mov.valor);
        UPDATE public.agendamentos
           SET valor_gorjeta = v_novo_gorjeta
         WHERE id = v_ag.id;
      ELSIF mov.tipo = 'entrada' AND COALESCE(mov.valor, 0) > 0 THEN
        SELECT id INTO v_hist_id
          FROM public.pagamento_historico
         WHERE agendamento_id = v_ag.id
           AND acao <> 'acrescimo'
           AND ABS(valor_delta - mov.valor) < 0.02
         ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - mov.ocorrido_em))) ASC
         LIMIT 1;

        IF v_hist_id IS NOT NULL THEN
          DELETE FROM public.pagamento_historico WHERE id = v_hist_id;
        END IF;

        v_novo_pago := GREATEST(0, COALESCE(v_ag.valor_pago, 0) - mov.valor);
        v_novo_status := CASE
          WHEN v_ag.status IN ('cancelado', 'falta') THEN v_ag.status
          WHEN v_novo_pago >= GREATEST(0, COALESCE(v_ag.valor, 0) - COALESCE(v_ag.valor_desconto_credito, 0)) - 0.01 THEN v_ag.status
          ELSE 'confirmado'
        END;

        UPDATE public.agendamentos
           SET valor_pago = v_novo_pago,
               status = v_novo_status,
               paid_at = CASE WHEN v_novo_pago <= 0 THEN NULL ELSE v_ag.paid_at END
         WHERE id = v_ag.id;
      END IF;
    END IF;
  ELSIF mov.referencia_tipo = 'venda' AND mov.tipo = 'entrada' AND COALESCE(mov.valor, 0) > 0 THEN
    UPDATE public.vendas
       SET valor_pago = GREATEST(0, COALESCE(valor_pago, 0) - mov.valor),
           pago = (GREATEST(0, COALESCE(valor_pago, 0) - mov.valor) >= COALESCE(valor_total, 0) - 0.01)
     WHERE id = mov.referencia_id;
  END IF;

  PERFORM set_config('app.skip_caixa_trigger', 'false', true);

  RETURN jsonb_build_object(
    'deleted', true,
    'referencia_tipo', mov.referencia_tipo,
    'referencia_id', mov.referencia_id,
    'tipo', mov.tipo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_lancamento_caixa(UUID) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
