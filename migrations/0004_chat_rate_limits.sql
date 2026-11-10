CREATE TABLE IF NOT EXISTS chat_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  requests INTEGER NOT NULL
);
