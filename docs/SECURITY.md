# Security

Phase 0 security practices:

- Never commit `.env` files or production secrets.
- Use different JWT access and refresh secrets per environment.
- Keep bcrypt rounds between 10 and 14; production default is 12.
- Validate all inbound DTOs and reject unknown fields.
- Store only password hashes, never plaintext passwords.
- Keep incident location access behind authenticated endpoints.
- Use Redis for future queue-backed notification dispatch rather than synchronous emergency fanout.
- Add audit logging and device binding before production launch.