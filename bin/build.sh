#!/usr/bin/env sh
cd bin || exit 1
packages=$(node ./list_packages.js)
cd ..
npm ci
echo "${PWD}"
for package in ${packages}; do
  echo "Building ${package}"
  npm run build -w "${package}"
done
