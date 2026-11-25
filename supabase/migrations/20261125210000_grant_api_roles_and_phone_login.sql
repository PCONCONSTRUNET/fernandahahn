-- =====================================================================
-- 1) Permissões das roles da API no schema public
--
-- No projeto novo as tabelas ficaram SEM privilégios para anon / authenticated /
-- service_role (só TRUNCATE/REFERENCES/TRIGGER), então o app não conseguia ler nem
-- gravar nada (ex.: perfil do cliente aparecia vazio). A segurança continua sendo
-- feita pelo RLS (políticas já existentes); aqui só restauramos o padrão do Supabase.
-- =====================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Garante o mesmo padrão para tabelas/funções criadas no futuro por migrations
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- =====================================================================
-- 2) Login com telefone/WhatsApp
--
-- O cadastro usa o e-mail real do cliente. Para entrar com telefone, esta função
-- encontra o e-mail do perfil pelo WhatsApp, mas SÓ devolve o e-mail se a senha
-- estiver correta (nunca expõe e-mail de quem não sabe a senha). Há bloqueio
-- temporário após várias tentativas erradas, para não virar força bruta.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.login_phone_attempts (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  attempted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_phone_attempts_phone_time
  ON public.login_phone_attempts (phone, attempted_at DESC);

-- Sem políticas: ninguém acessa pela API; só a função (SECURITY DEFINER) escreve.
ALTER TABLE public.login_phone_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_phone_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.login_email_for_phone(p_phone TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_digits TEXT := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 11);
  v_email TEXT;
  v_fails INTEGER;
BEGIN
  IF length(v_digits) < 10 OR COALESCE(p_password, '') = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_fails
    FROM public.login_phone_attempts
   WHERE phone = v_digits
     AND attempted_at > now() - interval '15 minutes';

  IF v_fails >= 8 THEN
    RAISE EXCEPTION 'TOO_MANY_ATTEMPTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.email INTO v_email
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE right(regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g'), 11) = v_digits
     AND u.encrypted_password IS NOT NULL
     AND u.encrypted_password = crypt(p_password, u.encrypted_password)
   LIMIT 1;

  IF v_email IS NULL THEN
    INSERT INTO public.login_phone_attempts (phone) VALUES (v_digits);
    -- limpeza oportunista de registros antigos
    DELETE FROM public.login_phone_attempts WHERE attempted_at < now() - interval '1 day';
    RETURN NULL;
  END IF;

  DELETE FROM public.login_phone_attempts WHERE phone = v_digits;
  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.login_email_for_phone(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_email_for_phone(TEXT, TEXT) TO anon, authenticated;
