-- Generated only after grounding the proposal in DataHub schema and lineage.
-- Source: analytics.customers_360
-- Governance rule: the raw PII email field must not reach CRM activation.

select
  customer_id,
  sha2(lower(trim(email)), 256) as email_hash,
  upper(country) as country,
  lifetime_value
from analytics.customers_360
where marketing_consent = true;
