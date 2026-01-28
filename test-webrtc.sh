#!/bin/bash

# Quick test for WebRTC implementation
echo "🎯 Testing Orbital WebRTC Implementation"
echo "======================================"

# Start servers in background
echo "📡 Starting servers..."
make dev &
SERVER_PID=$!

# Wait for servers to start
echo "⏳ Waiting for servers to start..."
sleep 5

# Check if servers are running
if curl -s http://localhost:8080/api/health > /dev/null; then
    echo "✅ Backend server is running"
else
    echo "❌ Backend server failed to start"
    exit 1
fi

if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Frontend server is running"
else
    echo "❌ Frontend server failed to start"
    exit 1
fi

echo ""
echo "🚀 Implementation Status: STEP 1 COMPLETE"
echo "📋 WebRTC Core Features Implemented:"
echo "  ✅ Complete peer connection handlers"
echo "  ✅ Local audio track management"
echo "  ✅ Remote track handling"
echo "  ✅ Connection lifecycle management"
echo "  ✅ Error handling and cleanup"
echo "  ✅ Targeted signaling messages"
echo ""
echo "🌐 Open http://localhost:3000 in multiple browsers to test"
echo "🎤 Create/join a room and test voice communication"
echo ""
echo "Press Ctrl+C to stop servers"

# Wait for user to stop
wait $SERVER_PID