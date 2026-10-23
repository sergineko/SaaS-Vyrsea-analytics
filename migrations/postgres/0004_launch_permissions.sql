-- New tables remain in the private schema. Runtime gets only the DML rights
-- needed by the application; it cannot alter schemas, migrations or roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vyrsea_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON
      vyrsea.team_members,vyrsea.team_invitations,vyrsea.audit_events,
      vyrsea.status_announcements,vyrsea.status_updates,vyrsea.status_domains,
      vyrsea.alert_destinations,vyrsea.alert_deliveries,vyrsea.email_receipts
    TO vyrsea_app;
  END IF;
END
$$;
