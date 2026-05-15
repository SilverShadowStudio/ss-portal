-- Update airtable_contact_field_config with confirmed Airtable field names.
-- Users table (tbl8V5Hd20UN9Jax6) = one row per person
-- Clients table (tblWDmSeRB4P88ALw) = one row per company
INSERT INTO app_settings (key, value)
VALUES (
  'airtable_contact_field_config',
  '{
    "base_id": "appyidJqOmdNB8WUd",
    "table_id": "tbl8V5Hd20UN9Jax6",
    "field_first_name": "First Name",
    "field_surname": "Surname",
    "field_role": "Role",
    "field_type_of_client": "Type of Client",
    "field_email": "Email",
    "field_client_link": "Clients",
    "field_company_link": "Company",
    "clients_table_id": "tblWDmSeRB4P88ALw",
    "field_company_name": "Company name",
    "field_client_representative": "Client Representative"
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
