#!/bin/env bash

IPFS_SUBDOMAIN_SUPPORT=true 
ASK_ENABLED=true
DNSQUERY_ENABLED=true

npm i
npm i --workspaces
npm run dev -w packages/dweb-api-server