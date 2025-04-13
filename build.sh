#!/bin/bash

# Clean dist directory
rm -rf dist
mkdir -p dist

# Run webpack build
npm run build

echo "Extension built successfully in the dist directory"
echo "To load the extension in Chrome:"
echo "1. Go to chrome://extensions/"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked' and select the dist folder" 