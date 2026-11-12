#!/bin/sh
# Builds dist/ at HEAD and publishes it as the gh-pages branch (GitHub Pages serves that branch).
set -eu
npm run -s build
sha=$(git rev-parse HEAD)
remote=$(git remote get-url origin)
touch dist/.nojekyll
cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy build $sha"
git push -q -f "$remote" gh-pages
rm -rf .git
echo "deployed build $sha to gh-pages"
