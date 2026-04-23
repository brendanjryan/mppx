---
'mppx': patch
---

Fixed credential `opaque` serialization to use the spec-compliant base64url string shape, while keeping deserialization backward-compatible with legacy object-shaped credentials.
