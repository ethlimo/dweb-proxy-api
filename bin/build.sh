#!/usr/bin/env sh
cd bin || exit 1
packages=$(node ./list_packages.js)
cd ..
npm i
echo "${PWD}"
for package in ${packages}; do
  echo "Building ${package}"
  npm i -w "${package}"
  npm run build -w "${package}"
done
