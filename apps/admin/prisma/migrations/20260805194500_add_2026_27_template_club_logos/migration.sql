-- The 2026-27 promoted Championship clubs need the same Transfermarkt crest
-- URL format as the existing curated template catalogue.
UPDATE "template_clubs"
SET
  "logo_url" = CASE "name"
    WHEN 'Bolton Wanderers' THEN 'https://tmssl.akamaized.net//images/wappen/big/355.png'
    WHEN 'Cardiff City' THEN 'https://tmssl.akamaized.net//images/wappen/big/603.png'
    WHEN 'Lincoln City' THEN 'https://tmssl.akamaized.net//images/wappen/big/1198.png'
  END,
  "updated_at" = now()
WHERE "name" IN ('Bolton Wanderers', 'Cardiff City', 'Lincoln City');
