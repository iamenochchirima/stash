-- Keep account-scoped connection events indexed after the connection itself is revoked.
CREATE INDEX admin_audit_connection_user
ON admin_audit ((changes->>'userId'), created_at)
WHERE action = 'connection.revoke';
