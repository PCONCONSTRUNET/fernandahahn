-- Restaura colunas usadas pelo painel Admin (Pagamentos, Pedidos, Clientes, Ficha)
-- e cria a RPC admin_update_profile usada na edição da ficha do cliente.

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS valor_troco NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_credito NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credito_saldo NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_user_id UUID,
  p_nome TEXT,
  p_whatsapp TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
  SET
    nome = COALESCE(p_nome, ''),
    whatsapp = COALESCE(p_whatsapp, ''),
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, nome, whatsapp)
    VALUES (p_user_id, COALESCE(p_nome, ''), COALESCE(p_whatsapp, ''))
    ON CONFLICT (id) DO UPDATE
      SET nome = EXCLUDED.nome,
          whatsapp = EXCLUDED.whatsapp,
          updated_at = now();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT) TO authenticated, anon;

-- Garante que o PostgREST recarregue o schema imediatamente
NOTIFY pgrst, 'reload schema';
