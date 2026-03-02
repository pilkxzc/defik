#!/bin/bash

echo "=== Session Persistence Test via /api/auth/me ==="
echo ""

# Test 1: Get user info with valid session
echo "Test 1: GET /api/auth/me with authenticated session"
RESPONSE=$(curl -s -b /tmp/cookies.txt http://localhost:3000/api/auth/me)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/cookies.txt http://localhost:3000/api/auth/me)
echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$RESPONSE" | head -c 200
echo ""
echo ""

# Test 2: Verify user ID matches
echo "Test 2: Extract user ID from response"
USER_ID=$(echo "$RESPONSE" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
echo "User ID from /api/auth/me: $USER_ID"
echo ""

# Test 3: Check if response contains required fields
echo "Test 3: Verify response contains required fields"
for field in "id" "email" "fullName" "balance" "activeAccount"; do
  if echo "$RESPONSE" | grep -q "\"$field\""; then
    echo "✅ Field '$field' found"
  else
    echo "❌ Field '$field' missing"
  fi
done
echo ""

# Test 4: Logout and verify session is destroyed
echo "Test 4: Test session destruction after logout"
LOGOUT_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/auth/logout)
echo "Logout Response: $LOGOUT_RESPONSE"
echo ""

# Test 5: Try to access /api/auth/me after logout
echo "Test 5: Verify session is destroyed - GET /api/auth/me after logout"
AFTER_LOGOUT=$(curl -s -b /tmp/cookies.txt http://localhost:3000/api/auth/me)
HTTP_CODE_AFTER=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/cookies.txt http://localhost:3000/api/auth/me)
echo "HTTP Status after logout: $HTTP_CODE_AFTER"
if [ "$HTTP_CODE_AFTER" = "401" ]; then
  echo "✅ Session properly destroyed (401 Unauthorized)"
else
  echo "⚠️  Unexpected status: $HTTP_CODE_AFTER (expected 401)"
fi
