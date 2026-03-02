# Investigation Results: Login Authentication Failure

**Date:** 2026-03-02
**Status:** Root cause identified and documented
**Severity:** Critical (blocks user login)

---

## Summary

The login authentication failure is caused by **email case sensitivity** in SQLite database queries. Users registered with mixed-case emails (e.g., `Test@Example.COM`) cannot log in with lowercase emails (e.g., `test@example.com`) because the backend doesn't normalize email addresses to lowercase before database lookups.

---

## Root Cause Analysis

### Issue Description

The backend receives login requests correctly and validates credentials properly, but the SQL query used to look up users by email is **case-sensitive**:

```javascript
// server/routes/auth.js, line 101 (LOGIN)
const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);

// server/routes/auth.js, line 30 (REGISTER)
const existingUser = dbGet('SELECT id FROM users WHERE email = ?', [email]);
```

SQLite uses case-sensitive string comparisons by default, so:
- User registers with email: `Test@Example.COM` → stored in DB as `Test@Example.COM`
- User tries to login with email: `test@example.com` → SQL query doesn't find a match → "Invalid credentials" error

### Evidence

**Test Setup:**
- Database contains user with email: `Test@Example.COM`
- Password: `password123` (bcrypt hash stored in database)

**Test Results:**

| Test Case | Request | Response | HTTP Status | Analysis |
|-----------|---------|----------|-------------|----------|
| Lowercase email | `POST /api/auth/login` with `test@example.com` | `{"error": "Invalid credentials"}` | 401 | ❌ FAILS - Email case mismatch |
| Correct case email | `POST /api/auth/login` with `Test@Example.COM` | `{"success": true, "user": {...}}` | 200 | ✅ SUCCEEDS - Exact match found |
| Wrong password | `POST /api/auth/login` with `Test@Example.COM` + wrong password | `{"error": "Invalid credentials"}` | 401 | ✅ CORRECT - Password validation works |

**cURL Test Requests:**
```bash
# Test 1: Lowercase email (FAILS with case sensitivity bug)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
# Response: {"error": "Invalid credentials"}

# Test 2: Correct case (SUCCEEDS)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"Test@Example.COM","password":"password123"}'
# Response: {"success": true, "user": {...}}

# Test 3: Wrong password (Correctly fails)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"Test@Example.COM","password":"wrongpassword"}'
# Response: {"error": "Invalid credentials"}
```

---

## Backend Verification

✅ **Backend is receiving login requests correctly**
- Server is running on port 3000
- POST requests to `/api/auth/login` are handled properly
- Requests reach the auth route handler in `server/routes/auth.js`

✅ **Error responses are correct and consistent**
- Line 101-103: Returns `401 Unauthorized` with `{"error": "Invalid credentials"}` when user not found
- Line 110-112: Returns `401 Unauthorized` with `{"error": "Invalid credentials"}` when password is invalid
- Line 106-107: Returns `403 Forbidden` with ban reason if user is banned
- Generic error message prevents exposing which credential is invalid (good security practice)

✅ **Session management is working**
- `sessions.json` contains valid session entries with `userId` and `betaAccess` flags
- Successful login creates a session with proper cookie configuration

✅ **Password validation is working**
- bcrypt comparison at line 110 correctly validates passwords
- Wrong password returns 401 error (not a successful login)

---

## Affected Files

### Primary Issues

1. **`server/routes/auth.js` - Line 101 (Login handler)**
   - Email not normalized to lowercase before database lookup
   - Need to add: `email.toLowerCase()` before SQL query
   - Impact: Login fails when email case doesn't exactly match registered email

2. **`server/routes/auth.js` - Line 30 (Register handler)**
   - Email not normalized to lowercase before duplicate check
   - Need to add: `email.toLowerCase()` before SQL query
   - Impact: Users could register same email with different cases (e.g., `Test@Example.COM` and `test@example.com`)

### Related Areas (should also normalize email)

- Line 38 in register: Email should be stored in lowercase in database
- Any other code that queries users by email should normalize input

---

## Detailed Error Flow

### When login fails (lowercase email):

1. **Request:** User sends `POST /api/auth/login` with `email: "test@example.com"`
2. **Line 97-99:** Email validation passes (not empty)
3. **Line 101:** SQL query executes: `SELECT * FROM users WHERE email = 'test@example.com'`
4. **SQLite:** Case-sensitive search doesn't find user with `email = 'Test@Example.COM'`
5. **Line 102-104:** `user` is null, returns `401 Unauthorized` with "Invalid credentials"
6. **Frontend:** User sees error message, login fails
7. **Session:** No session created, user remains unauthenticated

### When login succeeds (correct case):

1. **Request:** User sends `POST /api/auth/login` with `email: "Test@Example.COM"`
2. **Line 97-99:** Email validation passes
3. **Line 101:** SQL query finds user: `SELECT * FROM users WHERE email = 'Test@Example.COM'`
4. **SQLite:** Case-sensitive match found
5. **Line 110:** Password validation passes (bcrypt.compare)
6. **Line 149-150:** Session created with `userId` and `betaAccess`
7. **Line 157-170:** Returns `200 OK` with user data
8. **Frontend:** User redirected to dashboard, authenticated
9. **Session:** User remains logged in across page reloads

---

## Impact Assessment

### Who is affected?

- **Users with mixed-case emails:** Cannot log in with lowercase (or any case variation different from registered email)
- **Example scenarios:**
  - Registered with: `MyEmail@Gmail.COM` → Can only login with exactly that case
  - Registered with: `John.Doe@EXAMPLE.COM` → Cannot login with `john.doe@example.com`
  - Most users will fail to login if they use lowercase (standard email input habit)

### Scope of the bug

- **Frontend:** Not the issue; form submission works correctly
- **API request/response:** Not the issue; API handling is correct
- **Backend authentication logic:** ⚠️ **THIS IS THE ISSUE** - Email lookup is case-sensitive
- **Session management:** Not the issue; sessions create correctly after successful login
- **Password validation:** Not the issue; bcrypt works correctly

### Severity

- **Critical:** Prevents core functionality (user login) from working
- **Scope:** Affects all users with mixed-case emails
- **Frequency:** Very common issue (most users expect case-insensitive email matching)

---

## Expected Fix

### Solution: Normalize email to lowercase

Email addresses are case-insensitive according to RFC 5321. The fix should:

1. Normalize email to lowercase in login handler (line 101)
2. Normalize email to lowercase in register handler (lines 30, 38)
3. Store email in lowercase in database during registration
4. Verify no other code depends on case-sensitive email lookups

### Files to modify:
- `server/routes/auth.js` - Add `.toLowerCase()` to email before SQL queries and storage

### Expected outcome after fix:
- User can register with `Test@Example.COM`
- User can login with `test@example.com`, `TEST@EXAMPLE.COM`, or any case variation
- All existing functionality preserved
- No breaking changes to API or session management

---

## Testing Recommendations

After implementing the fix:

1. **Test Case Variations:** Register with `Test@Example.COM`, login with variations:
   - `test@example.com` ✅
   - `TEST@EXAMPLE.COM` ✅
   - `Test@Example.COM` ✅
   - `TeSt@ExAmPle.CoM` ✅

2. **Regression Testing:**
   - Register with lowercase email → login with same lowercase ✅
   - Register with mixed case → logout → login again ✅
   - 2FA flow still works with case normalization ✅
   - Session persistence works after login ✅

3. **Database Integrity:**
   - Check that all email addresses are normalized to lowercase in DB
   - Verify no duplicate emails with different cases

---

## Blockers & Dependencies

- ❌ **None identified** - Root cause is isolated and straightforward
- ✅ Ready for Phase 2 implementation
- ✅ No database migration needed (fix can be applied immediately)
- ✅ No breaking changes expected

---

## Conclusion

The login authentication failure is confirmed to be a **single, well-defined issue: email case sensitivity**. The backend is functioning correctly (receiving requests, validating passwords, creating sessions), but the email lookup in the database is case-sensitive. The fix is straightforward: normalize email addresses to lowercase before database queries and storage.

**Next Step:** Implement email normalization in `server/routes/auth.js` (Phase 2 of implementation plan).
