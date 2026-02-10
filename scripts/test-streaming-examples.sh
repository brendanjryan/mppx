#!/bin/bash
set -e

EXAMPLES_DIR="$(cd "$(dirname "$0")/../examples" && pwd)"
RESULTS=()
FAILED=0

test_example() {
  local name="$1"
  local dir="$2"
  echo ""
  echo "=========================================="
  echo "Testing: $name"
  echo "Dir: $dir"
  echo "=========================================="

  # Start vite server in background
  cd "$dir"
  npx vite --port 5173 2>&1 &
  SERVER_PID=$!
  
  # Wait for server to be ready
  echo "Waiting for server to start (PID: $SERVER_PID)..."
  for i in $(seq 1 60); do
    if curl -sf http://localhost:5173/api/health > /dev/null 2>&1; then
      echo "Server ready after ${i}s"
      break
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      echo "Server process died!"
      RESULTS+=("$name: FAILED (server died)")
      FAILED=1
      return
    fi
    sleep 1
  done

  if ! curl -sf http://localhost:5173/api/health > /dev/null 2>&1; then
    echo "Server failed to start after 60s"
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    RESULTS+=("$name: FAILED (server timeout)")
    FAILED=1
    return
  fi

  # Run client
  echo "Running client..."
  if npx tsx src/client.ts 2>&1; then
    echo ""
    echo "✓ $name: SUCCESS"
    RESULTS+=("$name: SUCCESS")
  else
    EXIT_CODE=$?
    echo ""
    echo "✗ $name: FAILED (exit code: $EXIT_CODE)"
    RESULTS+=("$name: FAILED (exit: $EXIT_CODE)")
    FAILED=1
  fi

  # Kill the server
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  sleep 1
}

# Test each streaming example
test_example "stream" "$EXAMPLES_DIR/stream"
test_example "streaming/single-fetch" "$EXAMPLES_DIR/streaming/single-fetch"
test_example "streaming/multi-fetch" "$EXAMPLES_DIR/streaming/multi-fetch"
test_example "streaming/sse" "$EXAMPLES_DIR/streaming/sse"

echo ""
echo "=========================================="
echo "RESULTS SUMMARY"
echo "=========================================="
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo ""

exit $FAILED
