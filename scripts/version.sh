#!/bin/bash
# Generate version string from git tag and commit hash
# Format: {semver}-{short_hash} (e.g., 1.0.0-816skays)

# Get the latest git tag (semver), default to 0.0.0 if no tags exist
SEMVER=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
if [ -z "$SEMVER" ]; then
    SEMVER="0.0.0"
fi

# Get short commit hash (8 characters)
HASH=$(git rev-parse --short=8 HEAD 2>/dev/null)
if [ -z "$HASH" ]; then
    HASH="unknown"
fi

# Combine into final version
VERSION="${SEMVER}-${HASH}"

# Output the version
echo "$VERSION"
