-- =====================================================================
-- MIGRATION: Otimização de Cron de Lembretes para Instância NANO
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-lembretes-every-10-min') THEN
    PERFORM cron.unschedule('send-lembretes-every-10-min');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Nota: configure o cron 'send-lembretes-every-30-min' manualmente no SQL Editor
-- com a URL e ANON_KEY do seu novo projeto Supabase:
-- SELECT cron.schedule(
--   'send-lembretes-every-30-min',
--   '*/30 * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://<SEU_PROJECT_ID>.supabase.co/functions/v1/send-lembretes',
--     headers := '{"Content-Type": "application/json", "apikey": "<SUA_ANON_KEY>"}'::jsonb,
--     body := concat('{"trigger": "cron", "time": "', now(), '"}')::jsonb
--   );
--   $$
-- );
