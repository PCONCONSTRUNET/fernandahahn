-- Adiciona suporte a PIX Direto (sem gateway) configurado na aba Gateway:
-- - Registro gateway = 'pix_direto' em gateway_configs
-- - access_token guarda a chave PIX
-- - public_key guarda o nome do titular recebedor
-- - whatsapp_comprovante guarda o WhatsApp para onde a cliente envia o comprovante

ALTER TABLE public.gateway_configs
  ADD COLUMN IF NOT EXISTS whatsapp_comprovante TEXT DEFAULT '5548999779829';

INSERT INTO public.gateway_configs (
  gateway,
  access_token,
  public_key,
  webhook_url,
  whatsapp_comprovante,
  ativo,
  pix_enabled,
  cartao_enabled,
  boleto_enabled
)
SELECT
  'pix_direto',
  '',
  'FERNANDA HAHN',
  '',
  '5548999779829',
  false,
  true,
  false,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.gateway_configs WHERE gateway = 'pix_direto'
);
