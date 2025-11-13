#!/bin/bash
# Build hook script to create google-services.json from EAS secret

if [ -z "$GOOGLE_SERVICES_JSON_BASE64" ]; then
  echo "Warning: GOOGLE_SERVICES_JSON_BASE64 environment variable is not set"
  exit 0
fi

echo "Creating google-services.json from EAS secret..."
echo "$GOOGLE_SERVICES_JSON_BASE64" | base64 -d > google-services.json

if [ -f "google-services.json" ]; then
  echo "✓ google-services.json created successfully"
else
  echo "✗ Failed to create google-services.json"
  exit 1
fi


