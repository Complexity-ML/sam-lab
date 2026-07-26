CREATE VIEW sam_mart.license_assignment_snapshot AS
SELECT
  seats.user_key,
  contracts.product_key,
  contracts.vendor,
  contracts.product,
  contracts.plan_type,
  seats.assigning_team,
  employees.department,
  employees.cost_center,
  employees.employment_status,
  employees.critical_access,
  seats.assigned_at,
  seats.seat_status,
  seats.pending_cancellation_date,
  usage.captured_at,
  usage.last_activity_at,
  usage.last_authenticated_at,
  usage.active_days_28d,
  usage.chat_requests,
  usage.code_completions,
  usage.agent_requests,
  usage.accepted_suggestions,
  contracts.purchased_seats,
  contracts.monthly_unit_cost,
  contracts.monthly_unit_cost * 12 AS annual_unit_cost,
  contracts.currency,
  contracts.renewal_date,
  contracts.contract_owner,
  contracts.approved,
  CASE
    WHEN usage.last_activity_at IS NULL THEN NULL
    ELSE usage.captured_at - usage.last_activity_at::date
  END AS days_since_last_activity
FROM sam_raw.copilot_seats AS seats
JOIN sam_raw.copilot_usage_28d AS usage USING (user_key)
JOIN sam_raw.employee_directory AS employees USING (user_key)
JOIN sam_raw.software_contracts AS contracts
  ON contracts.plan_type = seats.plan_type;

COMMENT ON VIEW sam_mart.license_assignment_snapshot IS
  'Versioned SAM evidence joining Copilot seats, bounded usage aggregates, contract rights and pseudonymized organization attributes.';

CREATE VIEW sam_mart.license_utilization AS
SELECT
  product_key,
  vendor,
  product,
  plan_type,
  MAX(purchased_seats) AS purchased_seats,
  COUNT(*) AS assigned_seats,
  COUNT(*) FILTER (
    WHERE last_activity_at::date >= captured_at - 30
  ) AS active_seats,
  MAX(purchased_seats) - COUNT(*) AS unassigned_seats,
  COUNT(*) FILTER (
    WHERE days_since_last_activity BETWEEN 31 AND 59
  ) AS inactive_30_to_59d,
  COUNT(*) FILTER (
    WHERE days_since_last_activity >= 60
  ) AS inactive_60d_plus,
  COUNT(*) FILTER (
    WHERE last_activity_at IS NULL
  ) AS never_active,
  MAX(monthly_unit_cost) AS monthly_unit_cost,
  MAX(annual_unit_cost) AS annual_unit_cost,
  MAX(purchased_seats * annual_unit_cost) AS annual_spend,
  (
    MAX(purchased_seats)
    - COUNT(*) FILTER (WHERE last_activity_at::date >= captured_at - 30)
  ) * MAX(annual_unit_cost) AS annualized_active_gap,
  MAX(currency) AS currency,
  MAX(renewal_date) AS renewal_date,
  MAX(contract_owner) AS owner,
  MAX(captured_at) AS captured_at
FROM sam_mart.license_assignment_snapshot
GROUP BY product_key, vendor, product, plan_type;

COMMENT ON VIEW sam_mart.license_utilization IS
  'Product-level purchased, assigned and active Copilot seat metrics used as the primary SAM LAB DataHub source.';

CREATE VIEW sam_mart.reclaim_candidates AS
SELECT
  assignments.user_key,
  assignments.product_key,
  utilization.product,
  assignments.department,
  assignments.cost_center,
  assignments.employment_status,
  assignments.critical_access,
  assignments.seat_status,
  assignments.pending_cancellation_date,
  assignments.last_activity_at,
  assignments.days_since_last_activity,
  assignments.active_days_28d,
  utilization.annual_unit_cost AS annual_savings_opportunity,
  utilization.currency,
  CASE
    WHEN assignments.critical_access THEN 'investigate_with_owner'
    WHEN assignments.employment_status = 'leaving' THEN 'reclaim_after_offboarding_check'
    WHEN assignments.last_activity_at IS NULL THEN 'reclaim_never_used'
    ELSE 'reclaim_inactive_60d'
  END AS recommendation,
  CASE
    WHEN assignments.critical_access THEN false
    ELSE true
  END AS savings_eligible,
  assignments.captured_at
FROM sam_mart.license_assignment_snapshot AS assignments
JOIN sam_mart.license_utilization AS utilization USING (product_key)
WHERE assignments.last_activity_at IS NULL
   OR assignments.days_since_last_activity >= 60;

COMMENT ON VIEW sam_mart.reclaim_candidates IS
  'Human-review queue for seats unused for at least 60 days or never used. Critical access is never auto-approved.';

CREATE VIEW sam_mart.renewal_risk AS
SELECT
  utilization.product_key,
  utilization.product,
  utilization.owner,
  utilization.renewal_date,
  utilization.renewal_date - utilization.captured_at AS days_to_renewal,
  utilization.purchased_seats,
  utilization.assigned_seats,
  utilization.active_seats,
  utilization.annual_spend,
  utilization.annualized_active_gap,
  COUNT(candidates.user_key) AS reclaim_candidate_count,
  COALESCE(SUM(candidates.annual_savings_opportunity) FILTER (
    WHERE candidates.savings_eligible
  ), 0) AS reviewed_savings_opportunity,
  utilization.currency,
  utilization.captured_at
FROM sam_mart.license_utilization AS utilization
LEFT JOIN sam_mart.reclaim_candidates AS candidates USING (product_key)
GROUP BY
  utilization.product_key,
  utilization.product,
  utilization.owner,
  utilization.renewal_date,
  utilization.captured_at,
  utilization.purchased_seats,
  utilization.assigned_seats,
  utilization.active_seats,
  utilization.annual_spend,
  utilization.annualized_active_gap,
  utilization.currency;

COMMENT ON VIEW sam_mart.renewal_risk IS
  'Renewal decision evidence combining contract timing, product utilization and the reviewed reclamation opportunity.';
