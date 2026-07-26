# Judge-readable SAM LAB presets

These synthetic examples match the optional canvases under **Settings → Examples**. SAM LAB still starts with a blank workbench; loading a preset is always explicit.

Each JSON file states the initial validation findings and the smallest expected agent diff. The files are review artifacts, not recorded provider responses, and contain no credentials, raw production rows, or private organizational metadata.

- `pii-masking.expected.json`: protects a classified field before activation.
- `schema-drift.expected.json`: traces a training-data drift through features to a production model, then restores the declared contract.
- `broken-governance.expected.json`: blocks publication until ownership and quality signals are repaired.
