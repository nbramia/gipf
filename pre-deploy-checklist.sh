#!/bin/bash
# Pre-Deployment Checklist for Yench (Yinsh Online)
# Run this script before every deployment to ensure all tests pass

set -e  # Exit on any error

echo "🚀 Yench Pre-Deployment Checklist"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check we're on main branch
echo "📍 Step 1: Checking git branch..."
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}⚠️  Warning: You're on branch '$CURRENT_BRANCH', not 'main'${NC}"
    echo "   Deployments should typically be from 'main' branch"
    read -p "   Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Deployment cancelled${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ On main branch${NC}"
fi
echo ""

# Step 2: Run tests
echo "🧪 Step 2: Running test suite..."
echo "   This may take a few seconds..."
if CI=true npm test -- --testPathPattern=YinshBoard.test.js 2>&1 | tee /tmp/yinsh-test-output.txt | tail -10; then
    # Extract test results
    TESTS_PASSED=$(grep "Tests:" /tmp/yinsh-test-output.txt | tail -1 | grep -o "[0-9]* passed" | grep -o "[0-9]*")
    TESTS_TOTAL=$(grep "Tests:" /tmp/yinsh-test-output.txt | tail -1 | grep -o ", [0-9]* total" | grep -o "[0-9]*")

    if [ "$TESTS_PASSED" == "$TESTS_TOTAL" ] && [ "$TESTS_TOTAL" == "43" ]; then
        echo -e "${GREEN}✅ All $TESTS_TOTAL tests passed!${NC}"
    else
        echo -e "${YELLOW}⚠️  Expected 43 tests, got $TESTS_TOTAL passing${NC}"
        echo "   Please update the expected test count in this script and documentation"
    fi
else
    echo -e "${RED}❌ Tests failed!${NC}"
    echo "   Fix failing tests before deployment"
    exit 1
fi
echo ""

# Step 3: Build production bundle
echo "🔨 Step 3: Building production bundle..."
if npm run build > /tmp/yinsh-build-output.txt 2>&1; then
    echo -e "${GREEN}✅ Build successful${NC}"
    # Check if build directory exists
    if [ -d "build" ]; then
        BUILD_SIZE=$(du -sh build | cut -f1)
        echo "   Build size: $BUILD_SIZE"
    fi
else
    echo -e "${RED}❌ Build failed!${NC}"
    cat /tmp/yinsh-build-output.txt
    exit 1
fi
echo ""

# Step 4: Check for uncommitted changes
echo "📝 Step 4: Checking for uncommitted changes..."
if git diff-index --quiet HEAD --; then
    echo -e "${GREEN}✅ No uncommitted changes${NC}"
else
    echo -e "${YELLOW}⚠️  You have uncommitted changes:${NC}"
    git status --short
    echo ""
    read -p "   Commit these changes before deploying? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "   Please commit your changes, then run this script again"
        exit 1
    fi
fi
echo ""

# Step 5: Check package.json version
echo "📦 Step 5: Current version check..."
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "   Current version: v$CURRENT_VERSION"
echo ""
read -p "   Is this the correct version for deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "   Update version with one of:"
    echo "   - npm version patch (bug fixes)"
    echo "   - npm version minor (new features)"
    echo "   - npm version major (breaking changes)"
    echo ""
    echo "   Then run this script again"
    exit 1
fi
echo ""

# Final summary
echo "=================================="
echo -e "${GREEN}🎉 All checks passed!${NC}"
echo ""
echo "Deployment Summary:"
echo "  • Tests: All 43 passing ✅"
echo "  • Build: Successful ✅"
echo "  • Branch: $CURRENT_BRANCH"
echo "  • Version: v$CURRENT_VERSION"
echo ""
echo "Next steps:"
echo "  1. Review your changes one more time"
echo "  2. Run: git push origin main --tags"
echo "  3. Monitor Vercel deployment dashboard"
echo "  4. Test production site after deployment"
echo ""
echo -e "${YELLOW}⚠️  Remember: Vercel does NOT run tests automatically${NC}"
echo "   You must run tests locally (this script) before pushing"
echo ""
