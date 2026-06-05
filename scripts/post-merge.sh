#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push


npm install libsodium-wrappers
# or
npm install tweetnacl

npm install libsodium-wrappers
# or
npm install tweetnacl

npm install libsodium-wrappers
# or
npm install tweetnacl