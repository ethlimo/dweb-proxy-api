#!/bin/env bash

export IPFS_SUBDOMAIN_SUPPORT=true 
export ASK_ENABLED=true
export DNSQUERY_ENABLED=true

npm install -g @aikidosec/safe-chain
safe-chain setup
safe-chain setup-ci

source ~/.bashrc

export SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=48

npm ci --ignore-scripts
npm run dev -w packages/dweb-api-server