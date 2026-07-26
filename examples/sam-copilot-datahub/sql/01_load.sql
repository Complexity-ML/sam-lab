\copy sam_raw.copilot_seats FROM '/demo-data/copilot_seats.csv' WITH (FORMAT csv, HEADER true);
\copy sam_raw.copilot_usage_28d FROM '/demo-data/copilot_usage_28d.csv' WITH (FORMAT csv, HEADER true);
\copy sam_raw.employee_directory FROM '/demo-data/employee_directory.csv' WITH (FORMAT csv, HEADER true);
\copy sam_raw.software_contracts FROM '/demo-data/software_contracts.csv' WITH (FORMAT csv, HEADER true);

ANALYZE sam_raw.copilot_seats;
ANALYZE sam_raw.copilot_usage_28d;
ANALYZE sam_raw.employee_directory;
ANALYZE sam_raw.software_contracts;
