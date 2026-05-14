INSERT INTO app_settings (key, value)
VALUES (
  'airtable_contact_field_config',
  '{"base_id":"","table_id":"","field_first_name":"","field_surname":"","field_role":"","field_type_of_client":"","field_email":""}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
