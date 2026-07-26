CREATE SCHEMA IF NOT EXISTS sam_raw;
CREATE SCHEMA IF NOT EXISTS sam_mart;

CREATE TABLE sam_raw.copilot_seats (
  user_key text PRIMARY KEY,
  assigned_at date NOT NULL,
  plan_type text NOT NULL,
  assigning_team text NOT NULL,
  seat_status text NOT NULL CHECK (seat_status IN ('assigned', 'pending_cancellation')),
  pending_cancellation_date date
);

CREATE TABLE sam_raw.copilot_usage_28d (
  user_key text PRIMARY KEY REFERENCES sam_raw.copilot_seats(user_key),
  captured_at date NOT NULL,
  last_activity_at timestamptz,
  last_authenticated_at timestamptz,
  active_days_28d integer NOT NULL CHECK (active_days_28d >= 0),
  chat_requests integer NOT NULL CHECK (chat_requests >= 0),
  code_completions integer NOT NULL CHECK (code_completions >= 0),
  agent_requests integer NOT NULL CHECK (agent_requests >= 0),
  accepted_suggestions integer NOT NULL CHECK (accepted_suggestions >= 0)
);

CREATE TABLE sam_raw.employee_directory (
  user_key text PRIMARY KEY REFERENCES sam_raw.copilot_seats(user_key),
  department text NOT NULL,
  cost_center text NOT NULL,
  employment_status text NOT NULL CHECK (employment_status IN ('active', 'leaving')),
  critical_access boolean NOT NULL
);

CREATE TABLE sam_raw.software_contracts (
  product_key text PRIMARY KEY,
  vendor text NOT NULL,
  product text NOT NULL,
  plan_type text NOT NULL,
  purchased_seats integer NOT NULL CHECK (purchased_seats >= 0),
  monthly_unit_cost numeric(10, 2) NOT NULL CHECK (monthly_unit_cost >= 0),
  currency text NOT NULL CHECK (char_length(currency) = 3),
  renewal_date date NOT NULL,
  contract_owner text NOT NULL,
  approved boolean NOT NULL,
  captured_at date NOT NULL
);

COMMENT ON TABLE sam_raw.copilot_seats IS
  'Synthetic and pseudonymized GitHub Copilot seat assignments for the SAM LAB demonstration.';
COMMENT ON COLUMN sam_raw.copilot_seats.user_key IS
  'Deterministic pseudonym. It is not a GitHub login, email address or reversible employee identifier.';
COMMENT ON TABLE sam_raw.copilot_usage_28d IS
  'Synthetic 28-day Copilot activity aggregates. No prompts, source code, completions or raw event rows are stored.';
COMMENT ON TABLE sam_raw.employee_directory IS
  'Synthetic organizational attributes limited to the fields required for owner review and cost allocation.';
COMMENT ON TABLE sam_raw.software_contracts IS
  'Synthetic contract and entitlement snapshot for GitHub Copilot Business.';
