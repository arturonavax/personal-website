CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  utm_source TEXT DEFAULT 'direct',
  utm_medium TEXT DEFAULT 'none',
  utm_campaign TEXT DEFAULT '',
  utm_content TEXT DEFAULT '',
  utm_term TEXT DEFAULT '',
  is_bot INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Visitas únicas, páginas más vistas y rendimiento filtrado por bots y fechas
CREATE INDEX IF NOT EXISTS idx_pageviews_analytics ON pageviews(is_bot, created_at, path);

-- Cálculo de visitantes únicos diarios y retención
CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_hash, created_at);

-- Atribución global consolidada por plataforma, medio y campaña
CREATE INDEX IF NOT EXISTS idx_pageviews_attribution ON pageviews(utm_source, utm_medium, utm_campaign, created_at);

-- Filtrado granular por identificador específico, destinatario o ID de post
CREATE INDEX IF NOT EXISTS idx_pageviews_content ON pageviews(utm_content, created_at);

-- Auditoría de referrers directos recibidos en cabeceras HTTP
CREATE INDEX IF NOT EXISTS idx_pageviews_referrer ON pageviews(is_bot, referrer, created_at);
