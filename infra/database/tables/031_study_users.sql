-- Controls which platform users have access to a study. Authorization inside
-- the platform continues to come from global RBAC roles.
CREATE TABLE IF NOT EXISTS study_users (
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (study_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_study_users_user_id
  ON study_users(user_id);

CREATE INDEX IF NOT EXISTS idx_study_users_added_by
  ON study_users(added_by);
