ALTER TABLE users ADD COLUMN suspended_at timestamptz;
ALTER TABLE users ADD COLUMN suspension_reason text;
ALTER TABLE users ADD COLUMN last_active_at timestamptz;
CREATE INDEX users_admin_created ON users(created_at,id);
CREATE INDEX users_admin_activity ON users(last_active_at);
CREATE TABLE admin_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','operator','viewer')),
 disabled_at timestamptz, recovery_pending_at timestamptz, mfa_secret text NOT NULL, pending_mfa_secret text, last_totp_step bigint NOT NULL DEFAULT -1,
 verified_at timestamptz NOT NULL, last_signed_in_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_sessions (
 hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, last_active_at timestamptz NOT NULL,
 authenticated_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_owner ON admin_sessions(admin_id);
CREATE TABLE admin_invites (
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), hash text PRIMARY KEY, email text NOT NULL, name text NOT NULL,
 purpose text NOT NULL DEFAULT 'enroll' CHECK(purpose IN ('enroll','recover')),
 role text NOT NULL CHECK(role IN ('owner','operator','viewer')),
 invited_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
 mfa_secret text, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_invite_email ON admin_invites(email);
CREATE TABLE admin_recovery_codes (
 hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
 target_id text, action text NOT NULL, reason text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('success','failed')), changes jsonb NOT NULL DEFAULT '{}',
 operation_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_audit_operation ON admin_audit(actor_id,operation_id);
CREATE INDEX admin_audit_created ON admin_audit(created_at,id);
CREATE INDEX admin_audit_target ON admin_audit(target_id,created_at);
CREATE TABLE admin_email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')),
 payload text, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX admin_email_pending ON admin_email_jobs(status,created_at);

CREATE INDEX admin_users_created ON admin_users(created_at,id);
CREATE INDEX admin_invites_created ON admin_invites(created_at,id);
