CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,

  display_name VARCHAR(200) NOT NULL,
  email VARCHAR(255) UNIQUE,
  institution VARCHAR(300),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_reason TEXT,
  last_login_at TIMESTAMPTZ,
  password_reset_required BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_disabled_reason_check
    CHECK (is_active OR disabled_reason IS NOT NULL)
);
