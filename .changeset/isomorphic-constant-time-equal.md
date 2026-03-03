---
"mppx": patch
---

Made `constantTimeEqual` isomorphic by replacing `node:crypto` with `ox` sha256 and a custom constant-time comparison.
