# Security Specification - Calculadora de PCP

This specification defines the security invariants and validation rules for the PCP calculator logs collection (`/calculations`).

## 1. Data Invariants

- A calculation record must belong to a valid machine code: `1001`, `1003`, or `1004`.
- All calculated numbers (`horasLiquidas`, `totalPecas`, `paletesTampas`, `metrosNecessarios`, `paletesSelo`) must be positive numbers.
- `createdAt` is a required timestamp set exactly to the server request time (`request.time`).
- Optional fields like `seloCod`, `seloNome` and `paletesSelo` must be correctly formatted if present.
- `hasWarning` must be a boolean indicating missing metrics error state.

---

## 2. The "Dirty Dozen" Payloads

We design these twelve payloads to verify that any invalid, spoofed, or malicious write will be blocked by Firestore rules:

1. **Undersized net hours write**: `horasLiquidas <= 0`
   - *Result*: `PERMISSION_DENIED`
2. **Unsupported machine code registration**: `maquina = 9999`
   - *Result*: `PERMISSION_DENIED`
3. **Immutability violation**: Attempting to alter a log's `createdAt` or `maquina` after creation.
   - *Result*: `PERMISSION_DENIED`
4. **Incorrect type injection**: `paletesTampas` passed as a string `"3"` instead of a number.
   - *Result*: `PERMISSION_DENIED`
5. **Timestamp spoofing**: `createdAt` sent as a pre-dated client string instead of `request.time`.
   - *Result*: `PERMISSION_DENIED`
6. **Shadow field injection (Ghost parameter)**: Sending unmapped properties like `isVerified: true` or `isAdmin: true`.
   - *Result*: `PERMISSION_DENIED`
7. **Extra large values / Denial of Wallet**: Sending massive 10MB strings as `produtoNome`.
   - *Result*: `PERMISSION_DENIED`
8. **Negative pieces quantity**: `totalPecas = -500`
   - *Result*: `PERMISSION_DENIED`
9. **Invalid Document ID injection**: Sending database IDs that contain weird chars (sql injection or directory traversal attempt).
   - *Result*: `PERMISSION_DENIED`
10. **Wrong type warning flag**: `hasWarning` written as `"YES"` instead of `true`/`false`.
    - *Result*: `PERMISSION_DENIED`
11. **Client delete attempt of historic data**: Since operators should only clear through authorized actions or completely block individual deletion if not authenticated.
    - *Result*: `PERMISSION_DENIED`
12. **Missing required fields**: Creating a record where `maquina` or `produtoCod` is absent.
    - *Result*: `PERMISSION_DENIED`

---

## 3. Security Rules Draft

The corresponding rules draft handles validation and ensures zero-trust protection without relying on client-side constraints.
