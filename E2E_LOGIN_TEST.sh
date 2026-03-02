#!/bin/bash

echo "========================================"
echo "End-to-End Login Flow Verification Test"
echo "========================================"
echo ""

# Cleanup
rm -f /tmp/e2e_cookies.txt

# Test 1: Register with mixed-case email
echo "Step 1: Register with mixed-case email (Test@E2E.COM)"
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"Test@E2E.COM","password":"E2EPassword123","fullName":"E2E Test User"}')
REG_SUCCESS=$(echo "$REGISTER_RESPONSE" | grep -o '"success":true')
if [ -n "$REG_SUCCESS" ]; then
  echo "✅ Registration successful"
  echo "   Response: $REGISTER_RESPONSE" | head -c 150
  echo ""
else
  echo "❌ Registration failed"
  echo "   Response: $REGISTER_RESPONSE"
fi
echo ""

# Test 2: Login with lowercase email
echo "Step 2: Login with lowercase email (test@e2e.com)"
LOGIN_RESPONSE=$(curl -s -c /tmp/e2e_cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@e2e.com","password":"E2EPassword123"}')
LOGIN_SUCCESS=$(echo "$LOGIN_RESPONSE" | grep -o '"success":true')
LOGIN_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
if [ -n "$LOGIN_SUCCESS" ]; then
  echo "✅ Login successful with lowercase email"
  echo "   User ID: $LOGIN_ID"
else
  echo "❌ Login failed"
  echo "   Response: $LOGIN_RESPONSE"
fi
echo ""

# Test 3: Verify session created
echo "Step 3: Verify session created"
SESSION_ID=$(grep -o 'connect.sid[[:space:]]*[^[:space:]]*' /tmp/e2e_cookies.txt | cut -d' ' -f2 | head -1)
if [ -n "$SESSION_ID" ]; then
  echo "✅ Session cookie created"
  echo "   Session ID (first 40 chars): ${SESSION_ID:0:40}..."
else
  echo "❌ No session cookie found"
fi
echo ""

# Test 4: Verify betaAccess flag in session file
echo "Step 4: Verify betaAccess flag in sessions.json"
BETA_FLAG=$(grep -A 10 "$SESSION_ID" ./server/sessions.json | grep '"betaAccess":true')
if [ -n "$BETA_FLAG" ]; then
  echo "✅ betaAccess flag found and set to true"
else
  echo "⚠️  Could not verify betaAccess flag (session might not be in file yet)"
fi
echo ""

# Test 5: Verify /api/auth/me returns user data
echo "Step 5: Verify /api/auth/me returns user data"
ME_RESPONSE=$(curl -s -b /tmp/e2e_cookies.txt http://localhost:3000/api/auth/me)
ME_SUCCESS=$(echo "$ME_RESPONSE" | grep -o '"id":')
if [ -n "$ME_SUCCESS" ]; then
  echo "✅ /api/auth/me returns user data"
  ME_EMAIL=$(echo "$ME_RESPONSE" | grep -o '"email":"[^"]*"')
  echo "   User: $ME_EMAIL"
else
  echo "❌ /api/auth/me failed"
  echo "   Response: $ME_RESPONSE"
fi
echo ""

# Test 6: Test dashboard access
echo "Step 6: Test dashboard access (HTTP status)"
DASHBOARD_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/e2e_cookies.txt http://localhost:3000/dashboard)
if [ "$DASHBOARD_HTTP" = "200" ]; then
  echo "✅ Dashboard accessible (HTTP 200)"
else
  echo "❌ Dashboard not accessible (HTTP $DASHBOARD_HTTP)"
fi
echo ""

# Test 7: Test dashboard without session
echo "Step 7: Test dashboard access without session (should be 403)"
NO_SESSION_HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard)
if [ "$NO_SESSION_HTTP" = "403" ]; then
  echo "✅ Dashboard blocked without session (HTTP 403)"
else
  echo "⚠️  Unexpected status without session: HTTP $NO_SESSION_HTTP (expected 403)"
fi
echo ""

# Test 8: Test case variation login (uppercase)
echo "Step 8: Login with UPPERCASE email (TEST@E2E.COM)"
LOGIN_UPPER=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"TEST@E2E.COM","password":"E2EPassword123"}')
UPPER_SUCCESS=$(echo "$LOGIN_UPPER" | grep -o '"success":true')
if [ -n "$UPPER_SUCCESS" ]; then
  echo "✅ Login successful with UPPERCASE email"
else
  echo "❌ Login failed with UPPERCASE email"
  echo "   Response: $LOGIN_UPPER"
fi
echo ""

# Test 9: Test case variation login (mixed case)
echo "Step 9: Login with mixed-case email (TeSt@E2E.cOm)"
LOGIN_MIXED=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"TeSt@E2E.cOm","password":"E2EPassword123"}')
MIXED_SUCCESS=$(echo "$LOGIN_MIXED" | grep -o '"success":true')
if [ -n "$MIXED_SUCCESS" ]; then
  echo "✅ Login successful with mixed-case email"
else
  echo "❌ Login failed with mixed-case email"
  echo "   Response: $LOGIN_MIXED"
fi
echo ""

# Test 10: Test logout
echo "Step 10: Logout and verify session destroyed"
LOGOUT_RESPONSE=$(curl -s -b /tmp/e2e_cookies.txt -X POST http://localhost:3000/api/auth/logout)
LOGOUT_SUCCESS=$(echo "$LOGOUT_RESPONSE" | grep -o '"success":true')
if [ -n "$LOGOUT_SUCCESS" ]; then
  echo "✅ Logout successful"
  
  # Verify session is destroyed
  AFTER_LOGOUT=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/e2e_cookies.txt http://localhost:3000/api/auth/me)
  if [ "$AFTER_LOGOUT" = "401" ]; then
    echo "✅ Session properly destroyed (401 Unauthorized)"
  else
    echo "⚠️  Session status after logout: HTTP $AFTER_LOGOUT (expected 401)"
  fi
else
  echo "❌ Logout failed"
  echo "   Response: $LOGOUT_RESPONSE"
fi
echo ""

echo "========================================"
echo "E2E Test Complete"
echo "========================================"
