#!/usr/bin/env bash

npm install -g @aikidosec/safe-chain
safe-chain setup
safe-chain setup-ci

source ~/.bashrc

export SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=48

cd bin || exit 1
packages=$(node ./list_packages.js)
cd ..
npm ci --ignore-scripts
echo "${PWD}"
for package in ${packages}; do
  echo "Building ${package}"
  npm run build -w "${package}"
done