#!/bin/bash
#
# Test different userAgent values against the Antigravity sandbox endpoint
# to find which ones work without getting 429 rate limit errors.
#
# Usage:
#   ./test-antigravity-useragent.sh <access_token> <project_id>
#
# Or with auth.json in current directory:
#   ./test-antigravity-useragent.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENDPOINT="https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse"
MODEL="gemini-3-pro"

# Try to get credentials from args or auth.json
if [[ -n "$1" && -n "$2" ]]; then
    ACCESS_TOKEN="$1"
    PROJECT_ID="$2"
else
    # Try various auth.json locations
    AUTH_FILE=""
    for path in "auth.json" "../auth.json" "$HOME/.pi/agent/auth.json"; do
        if [[ -f "$path" ]]; then
            AUTH_FILE="$path"
            break
        fi
    done
    
    if [[ -z "$AUTH_FILE" ]]; then
        echo "Usage: $0 <access_token> <project_id>"
        echo "   or: place auth.json in current directory or ~/.pi/agent/"
        exit 1
    fi
    
    echo "Reading credentials from $AUTH_FILE..."
    # Extract google-antigravity credentials
    ACCESS_TOKEN=$(jq -r '.["google-antigravity"].access // empty' "$AUTH_FILE" 2>/dev/null)
    PROJECT_ID=$(jq -r '.["google-antigravity"].projectId // empty' "$AUTH_FILE" 2>/dev/null)
    
    if [[ -z "$ACCESS_TOKEN" || -z "$PROJECT_ID" ]]; then
        echo -e "${RED}Error: Could not find google-antigravity credentials in $AUTH_FILE${NC}"
        echo "Expected structure: { \"google-antigravity\": { \"access\": \"...\", \"projectId\": \"...\" } }"
        exit 1
    fi
fi

echo "Project ID: $PROJECT_ID"
echo "Token: ${ACCESS_TOKEN:0:20}..."
echo ""

# Different userAgent values to test
USER_AGENTS=(
    "antigravity"
    "antigravity/1.11.5"
    "Antigravity"
    "pi-coding-agent"
    "google-cloud-sdk"
    "vscode"
    "vscode_cloudshelleditor/0.1"
    "cloudcode"
    ""
)

# Different HTTP User-Agent headers to test
HTTP_USER_AGENTS=(
    "antigravity/1.11.5 darwin/arm64"
    "google-cloud-sdk vscode_cloudshelleditor/0.1"
)

# Test function
test_request() {
    local body_user_agent="$1"
    local http_user_agent="$2"
    local label="$3"
    
    # Build request body
    local body
    if [[ -n "$body_user_agent" ]]; then
        body=$(cat <<EOF
{
    "project": "$PROJECT_ID",
    "model": "$MODEL",
    "request": {
        "contents": [{"role": "user", "parts": [{"text": "Say hi"}]}]
    },
    "userAgent": "$body_user_agent",
    "requestId": "test-$(date +%s)-$RANDOM"
}
EOF
)
    else
        body=$(cat <<EOF
{
    "project": "$PROJECT_ID",
    "model": "$MODEL",
    "request": {
        "contents": [{"role": "user", "parts": [{"text": "Say hi"}]}]
    },
    "requestId": "test-$(date +%s)-$RANDOM"
}
EOF
)
    fi
    
    # Make request
    local response
    local http_code
    
    response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Accept: text/event-stream" \
        -H "User-Agent: $http_user_agent" \
        -H "X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1" \
        -H 'Client-Metadata: {"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}' \
        -d "$body" \
        --max-time 10 2>/dev/null || echo -e "\n000")
    
    http_code=$(echo "$response" | tail -n1)
    local body_response=$(echo "$response" | sed '$d')
    
    # Check result
    if [[ "$http_code" == "200" ]]; then
        echo -e "${GREEN}[OK]${NC} $label"
        echo "    Response: ${body_response:0:100}..."
        return 0
    elif [[ "$http_code" == "429" ]]; then
        echo -e "${RED}[429 RATE LIMITED]${NC} $label"
        # Extract retry info if available
        local retry_info=$(echo "$body_response" | grep -o 'reset after [^"]*' | head -1)
        if [[ -n "$retry_info" ]]; then
            echo "    $retry_info"
        fi
        return 1
    elif [[ "$http_code" == "000" ]]; then
        echo -e "${YELLOW}[TIMEOUT/ERROR]${NC} $label"
        return 1
    else
        echo -e "${YELLOW}[HTTP $http_code]${NC} $label"
        echo "    Response: ${body_response:0:200}"
        return 1
    fi
}

echo "=============================================="
echo "Testing different userAgent combinations..."
echo "=============================================="
echo ""

# Test combinations
for http_ua in "${HTTP_USER_AGENTS[@]}"; do
    echo "--- HTTP User-Agent: $http_ua ---"
    echo ""
    
    for body_ua in "${USER_AGENTS[@]}"; do
        if [[ -z "$body_ua" ]]; then
            label="body.userAgent: (omitted)"
        else
            label="body.userAgent: \"$body_ua\""
        fi
        
        test_request "$body_ua" "$http_ua" "$label"
        
        # Small delay between requests to avoid overwhelming
        sleep 1
    done
    
    echo ""
done

echo "=============================================="
echo "Testing with additional metadata fields..."
echo "=============================================="
echo ""

# Test with metadata in body (like the OAuth discovery call uses)
test_with_metadata() {
    local body=$(cat <<EOF
{
    "project": "$PROJECT_ID",
    "model": "$MODEL",
    "request": {
        "contents": [{"role": "user", "parts": [{"text": "Say hi"}]}]
    },
    "userAgent": "antigravity",
    "requestId": "test-$(date +%s)-$RANDOM",
    "metadata": {
        "ideType": "IDE_UNSPECIFIED",
        "platform": "PLATFORM_UNSPECIFIED",
        "pluginType": "GEMINI"
    }
}
EOF
)
    
    local response
    response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Accept: text/event-stream" \
        -H "User-Agent: antigravity/1.11.5 darwin/arm64" \
        -H "X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1" \
        -H 'Client-Metadata: {"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}' \
        -d "$body" \
        --max-time 10 2>/dev/null || echo -e "\n000")
    
    local http_code=$(echo "$response" | tail -n1)
    local body_response=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "200" ]]; then
        echo -e "${GREEN}[OK]${NC} With metadata field in body"
        echo "    Response: ${body_response:0:100}..."
    else
        echo -e "${RED}[HTTP $http_code]${NC} With metadata field in body"
        echo "    Response: ${body_response:0:200}"
    fi
}

test_with_metadata

echo ""
echo "=============================================="
echo "Done! Copy a working combination to fix the provider."
echo "=============================================="
